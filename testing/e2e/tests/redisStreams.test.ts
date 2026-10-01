import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createRedisClient } from "@fluxify/adapters";
import { hydrateIntegrations } from "@fluxify/server/src/loaders/integrationsLoader";
import type { TriggerArtifact } from "@fluxify/server/src/modules/compiler/artifacts";
import {
	applyQueueTrigger,
	hasQueueTrigger,
	refreshQueueTriggers,
	setTriggerFaultReporter,
	type TriggerFault,
} from "@fluxify/server/src/modules/triggers/queueRuntime";
import type Docker from "dockerode";
import {
	docker,
	pullImage,
	removeIfPresent,
	startContainerWithRandomPort,
} from "../src/docker";
import { loadWorkflow } from "../src/graph";
import {
	WORKFLOW_PROJECT_ID,
	failNext,
	publishWorkflow,
	resetSink,
	sinkHits,
	workflowHarness,
} from "../src/workflow";

/**
 * Redis Streams triggers against a real Redis, running a real workflow.
 *
 * The trigger reads through a KV integration, the same one the KV blocks use;
 * the workflow reports every event it was handed to the sink. What the trigger
 * acked, left pending or dead-lettered is read back from Redis itself, because
 * that is the only place it is true.
 */

const IMAGE = "redis:7.4-alpine";
const CONTAINER = "fluxify-e2e-redis";
const INTEGRATION = "e2e-redis";
const TIMEOUT_MS = 20_000;

const workflow = await loadWorkflow("streamEvents");
let container: Docker.Container | undefined;
let redis: ReturnType<typeof createRedisClient>;
let config: Record<string, unknown>;
let faults: TriggerFault[] = [];
const started: string[] = [];
let seq = 0;

beforeAll(async () => {
	await workflowHarness();
	await publishWorkflow(workflow);
	await removeIfPresent(CONTAINER);
	await pullImage(IMAGE);
	const run = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: CONTAINER,
			HostConfig: {
				PortBindings: { "6379/tcp": [{ HostPort: String(port) }] },
				AutoRemove: true,
			},
		}),
	);
	container = run.container;
	config = { source: "credentials", host: "127.0.0.1", port: String(run.port) };
	redis = createRedisClient(config as never);
	redis.on("error", () => undefined);
	for (let i = 0; ; i++) {
		if ((await redis.ping().catch(() => "")) === "PONG") break;
		if (i > 120) throw new Error("redis container did not become ready");
		await Bun.sleep(250);
	}
	setTriggerFaultReporter((fault) => faults.push(fault));
}, 180_000);

beforeEach(() => {
	resetSink();
	faults = [];
	useIntegration(true);
});

afterEach(async () => {
	for (const id of started.splice(0)) await applyQueueTrigger(id, null);
});

afterAll(async () => {
	redis?.disconnect();
	await container?.stop().catch(() => {});
	await removeIfPresent(CONTAINER);
});

/** Puts the Redis integration in, or takes it out of, the worker's KV cache. */
function useIntegration(present: boolean) {
	hydrateIntegrations(WORKFLOW_PROJECT_ID, {
		kv: present
			? {
					[INTEGRATION]: {
						...config,
						variant: "Redis",
						group: "kv",
						__projectId: WORKFLOW_PROJECT_ID,
					},
				}
			: {},
	});
}

/** A fresh stream and trigger per test, so nothing one test leaves is seen by another. */
async function startTrigger(overrides: Partial<TriggerArtifact> = {}, source = {}) {
	const triggerId = `t-redis-${++seq}-${Date.now()}`;
	const stream = `orders-${triggerId}`;
	started.push(triggerId);
	await applyQueueTrigger(triggerId, {
		triggerId,
		projectId: WORKFLOW_PROJECT_ID,
		workflowId: workflow.name,
		groupId: "default",
		type: "redis",
		integrationId: INTEGRATION,
		batchSize: 1,
		maxWaitMs: 0,
		maxBytes: 1024 * 1024,
		concurrency: 1,
		source: { stream, ...source },
		commitMode: "auto",
		maxAttempts: 3,
		retryDelayMs: 0,
		publishedAt: new Date().toISOString(),
		...overrides,
	});
	expect(hasQueueTrigger(triggerId)).toBe(true);
	return { triggerId, stream, group: `fluxify-${triggerId}` };
}

async function until<T>(read: () => Promise<T> | T, ok: (value: T) => boolean, what: string) {
	const deadline = Date.now() + TIMEOUT_MS;
	let value = await read();
	while (!ok(value)) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await Bun.sleep(50);
		value = await read();
	}
	return value;
}

/** The batches the workflow reported for one stream, in order. */
function batchesFor(stream: string) {
	return sinkHits()
		.filter((hit) => hit.path === "/stream")
		.map((hit) => hit.body)
		.filter((body) => body?.events?.[0]?.meta?.topic === stream);
}

const waitForBatches = (stream: string, count: number) =>
	until(() => batchesFor(stream), (batches) => batches.length >= count, `${count} batches`);

async function pending(stream: string, group: string) {
	const [count] = (await redis.xpending(stream, group)) as [number];
	return count;
}

describe("a Redis Streams trigger", () => {
	it(
		"runs one workflow per entry, with its fields and metadata, then acks it",
		async () => {
			const { stream, group } = await startTrigger();
			const first = await redis.xadd(stream, "*", "id", "1", "status", "paid");
			await redis.xadd(stream, "*", "id", "2", "status", "new");

			const batches = await waitForBatches(stream, 2);
			expect(batches[0].events).toHaveLength(1);
			expect(batches[0].events[0]).toMatchObject({
				// values stay strings: Redis stores text
				data: { id: "1", status: "paid" },
				meta: {
					source: "redis",
					topic: stream,
					offset: first,
					consumer: expect.any(String),
					deliveryCount: 1,
				},
			});
			expect(batches[0].meta).toMatchObject({ consumerGroup: group, attempt: 1 });
			// read and not yet acked while the run is going: at least the entry itself
			expect(batches[0].lag).toBeGreaterThanOrEqual(1);
			expect(batches[1].events[0].data.id).toBe("2");
			await until(() => pending(stream, group), (n) => n === 0, "the entries to be acked");
		},
		TIMEOUT_MS,
	);

	it(
		"reads entries written before the group existed when told to start from the beginning",
		async () => {
			const stream = `orders-early-${Date.now()}`;
			for (const id of ["a", "b", "c"]) await redis.xadd(stream, "*", "id", id);
			// the trigger's own stream key is replaced with the one already written to
			await startTrigger({ batchSize: 10 }, { stream, fromBeginning: true });

			const [batch] = await waitForBatches(stream, 1);
			expect(batch.events.map((event: any) => event.data.id)).toEqual(["a", "b", "c"]);
		},
		TIMEOUT_MS,
	);

	it(
		"collects entries that trickle in into one run when told to wait",
		async () => {
			const { stream } = await startTrigger({ batchSize: 5, maxWaitMs: 3_000 });
			for (const id of ["1", "2", "3", "4", "5"]) {
				await redis.xadd(stream, "*", "id", id);
				await Bun.sleep(100);
			}

			const [batch] = await waitForBatches(stream, 1);
			expect(batch.events.map((event: any) => event.data.id)).toEqual(["1", "2", "3", "4", "5"]);
		},
		TIMEOUT_MS,
	);

	it(
		"dead-letters an entry to <stream>:dlq once its attempts run out",
		async () => {
			const { stream, group } = await startTrigger({ maxAttempts: 2 });
			failNext("/stream", 2);
			const id = await redis.xadd(stream, "*", "id", "poison");

			const dead = await until(
				() => redis.xrange(`${stream}:dlq`, "-", "+"),
				(entries) => entries.length === 1,
				"the dead-lettered entry",
			);
			const fields = Object.fromEntries(
				dead[0]![1].flatMap((_, i, all) => (i % 2 ? [] : [[all[i], all[i + 1]]])),
			);
			expect(fields).toMatchObject({
				id: "poison",
				"x-fluxify-stream": stream,
				"x-fluxify-id": id,
				"x-fluxify-consumer-group": group,
			});
			expect(fields["x-fluxify-error"]).toBeString();
			await until(() => pending(stream, group), (n) => n === 0, "the entry to be acked");
		},
		TIMEOUT_MS,
	);

	it(
		"leaves a manual-mode entry pending until the workflow commits it",
		async () => {
			const { stream, group } = await startTrigger({ commitMode: "manual" });
			await redis.xadd(stream, "*", "id", "kept");
			await redis.xadd(stream, "*", "id", "acked", "commit", "yes");

			await waitForBatches(stream, 2);
			// only the entry whose run committed has left the pending list
			await until(() => pending(stream, group), (n) => n === 1, "one entry left pending");
			const [[left]] = (await redis.xpending(stream, group, "-", "+", 10)) as [string][];
			const [[, fields]] = await redis.xrange(stream, left!, left!);
			expect(fields).toEqual(["id", "kept"]);
		},
		TIMEOUT_MS,
	);

	it(
		"reclaims an entry a dead consumer read and never acked",
		async () => {
			const stream = `orders-orphan-${Date.now()}`;
			const group = "shared-group";
			await redis.xgroup("CREATE", stream, group, "$", "MKSTREAM");
			await redis.xadd(stream, "*", "id", "orphan");
			// a consumer that read the entry and died before acking it
			await redis.xreadgroup("GROUP", group, "dead", "COUNT", 1, "STREAMS", stream, ">");

			await startTrigger({}, { stream, consumerGroup: group, claimIdleMs: 1_000 });
			const [batch] = await waitForBatches(stream, 1);
			expect(batch.events[0]).toMatchObject({
				data: { id: "orphan" },
				// the dead consumer's read counted, so this is the second delivery
				meta: { deliveryCount: 2 },
			});
			await until(() => pending(stream, group), (n) => n === 0, "the entry to be acked");
		},
		TIMEOUT_MS,
	);

	it(
		"stops when its integration is deleted",
		async () => {
			const { triggerId } = await startTrigger();
			useIntegration(false);
			await refreshQueueTriggers();
			expect(hasQueueTrigger(triggerId)).toBe(false);
		},
		TIMEOUT_MS,
	);

	it(
		"reports itself for disabling when its stream is deleted",
		async () => {
			const { triggerId, stream } = await startTrigger();
			await redis.xadd(stream, "*", "id", "before");
			await waitForBatches(stream, 1);
			await redis.del(stream);

			const [fault] = await until(() => faults, (all) => all.length > 0, "a fault report");
			expect(fault).toMatchObject({ triggerId, projectId: WORKFLOW_PROJECT_ID });
			expect(fault!.reason).toContain(stream);
			await until(() => hasQueueTrigger(triggerId), (running) => !running, "the trigger to stop");
		},
		TIMEOUT_MS,
	);
});
