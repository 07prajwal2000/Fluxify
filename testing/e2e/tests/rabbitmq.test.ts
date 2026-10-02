import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
	assertRabbitMqQueue,
	type RabbitMqConfig,
	testRabbitMqConnection,
} from "@fluxify/adapters/queue/rabbitmq";
import { hydrateIntegrations } from "@fluxify/server/src/loaders/integrationsLoader";
import type { TriggerArtifact } from "@fluxify/server/src/modules/compiler/artifacts";
import {
	applyQueueTrigger,
	hasQueueTrigger,
	refreshQueueTriggers,
	setTriggerFaultReporter,
	type TriggerFault,
} from "@fluxify/server/src/modules/triggers/queueRuntime";
import { type Channel, type ChannelModel, connect } from "amqplib";
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
 * RabbitMQ triggers against a real broker, running a real workflow.
 *
 * The workflow reports every event it was handed to the sink. What the trigger
 * acked, requeued or dead-lettered is read back from RabbitMQ itself: a queue
 * left empty after the trigger stops was acked, because stopping hands every
 * unacked message back.
 */

const IMAGE = "rabbitmq:4.2-alpine";
const CONTAINER = "fluxify-e2e-rabbitmq";
const INTEGRATION = "e2e-rabbitmq";
const TIMEOUT_MS = 20_000;

const workflow = await loadWorkflow("streamEvents");
let container: Docker.Container | undefined;
let config: Extract<RabbitMqConfig, { source: "credentials" }>;
let broker: ChannelModel;
let channel: Channel;
let faults: TriggerFault[] = [];
const started: string[] = [];
let seq = 0;

/** Until the broker takes an AMQP login; the port opens well before that. */
async function connectWhenReady() {
	for (let i = 0; ; i++) {
		try {
			return await connect(`amqp://127.0.0.1:${config.port}`);
		} catch (error) {
			if (i > 160) throw error;
			await Bun.sleep(500);
		}
	}
}

async function openTestChannel() {
	broker = await connectWhenReady();
	broker.on("error", () => undefined);
	channel = await broker.createChannel();
	channel.on("error", () => undefined);
}

beforeAll(async () => {
	await workflowHarness();
	await publishWorkflow(workflow);
	await removeIfPresent(CONTAINER);
	await pullImage(IMAGE);
	const run = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: CONTAINER,
			HostConfig: { PortBindings: { "5672/tcp": [{ HostPort: String(port) }] } },
		}),
	);
	container = run.container;
	config = { source: "credentials", host: "127.0.0.1", port: String(run.port) };
	await openTestChannel();
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
	await broker?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
	await removeIfPresent(CONTAINER);
});

/** Puts the RabbitMQ integration in, or takes it out of, the worker's queue cache. */
function useIntegration(present: boolean) {
	hydrateIntegrations(WORKFLOW_PROJECT_ID, {
		queue: present
			? {
					[INTEGRATION]: {
						...config,
						variant: "RabbitMQ",
						group: "queue",
						__projectId: WORKFLOW_PROJECT_ID,
					},
				}
			: {},
	});
}

/** A fresh queue and trigger per test, so nothing one test leaves is seen by another. */
async function startTrigger(
	overrides: Partial<TriggerArtifact> = {},
	queueArguments: Record<string, unknown> = {},
) {
	const triggerId = `t-rabbit-${++seq}-${Date.now()}`;
	const queue = `orders-${triggerId}`;
	await channel.assertQueue(queue, { arguments: queueArguments });
	started.push(triggerId);
	await applyQueueTrigger(triggerId, {
		triggerId,
		projectId: WORKFLOW_PROJECT_ID,
		workflowId: workflow.name,
		groupId: "default",
		type: "rabbitmq",
		integrationId: INTEGRATION,
		batchSize: 1,
		maxWaitMs: 0,
		maxBytes: 1024 * 1024,
		concurrency: 1,
		source: { queue },
		commitMode: "auto",
		maxAttempts: 3,
		retryDelayMs: 0,
		publishedAt: new Date().toISOString(),
		...overrides,
	});
	expect(hasQueueTrigger(triggerId)).toBe(true);
	return { triggerId, queue };
}

function send(queue: string, body: unknown, options: Record<string, unknown> = {}) {
	channel.sendToQueue(queue, Buffer.from(JSON.stringify(body)), options);
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

/** The batches the workflow reported for one queue, in order. */
function batchesFor(queue: string) {
	return sinkHits()
		.filter((hit) => hit.path === "/stream")
		.map((hit) => hit.body)
		.filter((body) => body?.events?.[0]?.meta?.topic === queue);
}

const waitForBatches = (queue: string, count: number) =>
	until(() => batchesFor(queue), (batches) => batches.length >= count, `${count} batches`);

/** Stops the trigger, which hands back anything unacked, then counts what is left. */
async function leftAfterStop(triggerId: string, queue: string) {
	await applyQueueTrigger(triggerId, null);
	return (await channel.checkQueue(queue)).messageCount;
}

describe("a RabbitMQ trigger", () => {
	it(
		"runs one workflow per message, with its body and delivery details, then acks it",
		async () => {
			const { triggerId, queue } = await startTrigger();
			send(queue, { id: 1 }, { messageId: "m-1", headers: { tenant: "acme" } });
			send(queue, { id: 2 });

			const batches = await waitForBatches(queue, 2);
			expect(batches[0].events).toHaveLength(1);
			expect(batches[0].events[0]).toMatchObject({
				data: { id: 1 },
				meta: {
					source: "rabbitmq",
					topic: queue,
					// built from the message id, so it holds across a redelivery
					id: `${queue}:0:m-1`,
					exchange: "",
					routingKey: queue,
					messageId: "m-1",
					redelivered: false,
					deliveryCount: 1,
					headers: { tenant: "acme" },
				},
			});
			expect(batches[0].meta).toMatchObject({ consumerGroup: `fluxify-${triggerId}`, attempt: 1 });
			expect(batches[1].events[0].data.id).toBe(2);
			expect(await leftAfterStop(triggerId, queue)).toBe(0);
		},
		TIMEOUT_MS,
	);

	it(
		"collects messages that trickle in into one run when told to wait",
		async () => {
			const { queue } = await startTrigger({ batchSize: 5, maxWaitMs: 3_000 });
			for (const id of [1, 2, 3, 4, 5]) {
				send(queue, { id });
				await Bun.sleep(100);
			}

			const [batch] = await waitForBatches(queue, 1);
			expect(batch.events.map((event: any) => event.data.id)).toEqual([1, 2, 3, 4, 5]);
		},
		TIMEOUT_MS,
	);

	it(
		"rejects a message to the queue's dead-letter exchange once its attempts run out",
		async () => {
			const dlq = `dlq-${Date.now()}`;
			await channel.assertQueue(dlq);
			const { triggerId, queue } = await startTrigger(
				{ maxAttempts: 2 },
				{ "x-dead-letter-exchange": "", "x-dead-letter-routing-key": dlq },
			);
			failNext("/stream", 2);
			send(queue, { id: "poison" });

			const dead = await until(
				() => channel.get(dlq, { noAck: true }),
				(message) => message !== false,
				"the dead-lettered message",
			);
			if (dead === false) throw new Error("unreachable");
			expect(JSON.parse(dead.content.toString())).toEqual({ id: "poison" });
			expect(dead.properties.headers?.["x-first-death-reason"]).toBe("rejected");
			expect(dead.properties.headers?.["x-first-death-queue"]).toBe(queue);
			expect(await leftAfterStop(triggerId, queue)).toBe(0);
		},
		TIMEOUT_MS,
	);

	it(
		"requeues a manual-mode message the workflow never committed, after the retry delay",
		async () => {
			const { triggerId, queue } = await startTrigger({ commitMode: "manual", retryDelayMs: 300 });
			send(queue, { id: "acked", commit: "yes" });
			send(queue, { id: "kept" });

			const batches = await waitForBatches(queue, 3);
			const ids = batches.map((batch) => batch.events[0].data.id);
			// the committed one runs once; the other comes back, marked as a second delivery
			expect(ids.filter((id) => id === "acked")).toHaveLength(1);
			const again = batches.filter((batch) => batch.events[0].data.id === "kept")[1];
			expect(again.events[0].meta).toMatchObject({ redelivered: true, deliveryCount: 2 });
			expect(await leftAfterStop(triggerId, queue)).toBe(1);
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
		"reports itself for disabling when its queue is deleted",
		async () => {
			const { triggerId, queue } = await startTrigger();
			send(queue, { id: "before" });
			await waitForBatches(queue, 1);
			await channel.deleteQueue(queue);

			const [fault] = await until(() => faults, (all) => all.length > 0, "a fault report");
			expect(fault).toMatchObject({ triggerId, projectId: WORKFLOW_PROJECT_ID });
			expect(fault!.reason).toContain(queue);
			await until(() => hasQueueTrigger(triggerId), (running) => !running, "the trigger to stop");
		},
		TIMEOUT_MS,
	);

	it(
		"refuses a queue that does not exist, and a wrong password, in words a user can act on",
		async () => {
			await expect(assertRabbitMqQueue(config, `missing-${Date.now()}`)).rejects.toThrow(
				/has no queue/,
			);
			expect(await testRabbitMqConnection(config)).toEqual({ success: true, error: "" });
			const wrong = await testRabbitMqConnection({ ...config, username: "guest", password: "nope" });
			expect(wrong.success).toBe(false);
			expect(wrong.error).toContain("refused the login");
		},
		TIMEOUT_MS,
	);

	it(
		"reconnects after the broker restarts and keeps consuming",
		async () => {
			// test queues are durable (amqplib's default), so this one survives the restart
			const { triggerId, queue } = await startTrigger();
			await container!.restart({ t: 1 });
			// the test's own channel went down with the broker
			await openTestChannel();
			send(queue, { id: "after-restart" });

			const [batch] = await waitForBatches(queue, 1);
			expect(batch.events[0].data.id).toBe("after-restart");
			expect(hasQueueTrigger(triggerId)).toBe(true);
		},
		90_000,
	);
});
