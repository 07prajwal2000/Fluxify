import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { closeNats, connectNats, openKvBucket } from "@fluxify/common/nats";
import { SQL } from "bun";
import { STOP_TTL_MS, stopKey } from "@fluxify/server/src/modules/jobs/runStops";
import { internalConsumerName } from "@fluxify/server/src/modules/triggers/subjects";
import { jetstreamManager } from "@nats-io/jetstream";
import { api } from "../src/envs";
import {
	call,
	count,
	installed,
	installRoute,
	installWorkflow,
	newKey,
	ok,
	release,
	runsOf,
	saw,
	stack,
	startStreaming,
	stopStreaming,
	until,
} from "../src/streaming";

// When a stop takes effect, what it leaves behind, and the limits on a run (#1041):
// real graphs fired and stopped from routes on one worker, running on another.

const paths = { fire: "/fire", stop: "/halt", slow: "/slow" };
let slow: string;
let nc: Awaited<ReturnType<typeof connectNats>>;
let bucket: Awaited<ReturnType<typeof openKvBucket>>;

beforeAll(async () => {
	await startStreaming();
	// the concurrency setting is admin-only, and the stack's creator is not one
	const sql = new SQL(stack.adminDb, { max: 1 });
	await sql`UPDATE access_control SET role = 'project_admin' WHERE user_id = ${stack.creatorId} AND project_id = ${stack.projectId}`;
	await sql.close();
	const target = await installWorkflow("stopTarget");
	slow = await installWorkflow("slowLoop", 2);
	await installRoute("sse/fire", paths.fire, { workflowId: target });
	await installRoute("sse/fire", paths.slow, { workflowId: slow });
	await installRoute("sse/halt", paths.stop);
	await installed();
	nc = await connectNats({ ...stack.nats, connectionName: "e2e-stops" } as never);
	bucket = await openKvBucket(nc, "fluxify_dev_run_stops", { ttlMs: STOP_TTL_MS });
}, 600_000);

afterAll(async () => {
	await closeNats("e2e-stops").catch(() => {});
	await stopStreaming();
});

const fire = (k: string, flags: { hold?: boolean; fail?: boolean; wait?: boolean } = {}) =>
	ok200(paths.fire, {
		k,
		...Object.fromEntries(Object.entries(flags).map(([flag, on]) => [flag, on ? "1" : "0"])),
	});
const stop = (k: string) => ok200(paths.stop, { k });

async function ok200(path: string, query: Record<string, string>) {
	const res = await call(path, query);
	if (res.status !== 200) throw new Error(`${path}: ${res.status} ${res.text}`);
}

async function entry(k: string) {
	const found = await bucket.store.get(stopKey(stack.projectId, k));
	return found?.operation === "PUT" ? found : null;
}
const entryExists = (k: string) => until(`the entry for ${k}`, async () => (await entry(k)) !== null);
const entryGone = (k: string) => until(`no entry for ${k}`, async () => (await entry(k)) === null);

/** Sets the limit and waits for the broker's consumer to carry it: the worker updates that last. */
async function setConcurrency(limit: number) {
	await ok(
		api(stack, "creator", `/v1/projects/${stack.projectId}/settings/keys`, {
			method: "PUT",
			body: { key: "settings.workflows.triggerConcurrency", value: String(limit) },
		}),
	);
	const manager = await jetstreamManager(nc);
	await until(`the limit of ${limit} to apply`, async () => {
		const { config } = await manager.consumers.info(
			"FLUXIFY_DEV_TRIGGERS",
			internalConsumerName(stack.projectId),
		);
		return config.max_ack_pending === limit;
	});
}

describe("with one run at a time", () => {
	beforeAll(() => setConcurrency(1));
	afterAll(() => setConcurrency(10));

	it("a stop while the run is still queued means it never starts", async () => {
		const first = newKey();
		const queued = newKey();
		await fire(first, { hold: true });
		await saw(first, "start");
		await fire(queued);

		await stop(queued);
		await entryExists(queued);
		await release(first);

		await saw(first, "end");
		await entryGone(queued);
		expect(count(queued, "start")).toBe(0);
	}, 60_000);
});

describe("a Run ID", () => {
	it("can be reused after a stop, and the new run completes", async () => {
		const k = newKey();
		await fire(k, { wait: true });
		await saw(k, "start");
		await stop(k);
		await saw(k, "end");
		await entryGone(k);

		await fire(k);

		await until("the second run", () => count(k, "end") === 2);
		expect(count(k, "start")).toBe(2);
	}, 60_000);
});

describe("a stop's entry", () => {
	it("is gone after a run that completed anyway", async () => {
		const k = newKey();
		await fire(k, { hold: true });
		await saw(k, "start");
		await stop(k);
		await entryExists(k);

		await release(k);

		await saw(k, "end");
		await entryGone(k);
	}, 60_000);

	it("is gone after a run that failed, which is not retried", async () => {
		const k = newKey();
		await fire(k, { hold: true, fail: true });
		await saw(k, "start");
		await stop(k);
		await entryExists(k);

		await release(k);

		await saw(k, "fail");
		await entryGone(k);
		await Bun.sleep(1_000); // past the retry delay
		expect(count(k, "start")).toBe(1);
	}, 60_000);
});

describe("the limits on a run", () => {
	it("with concurrency N, N runs are in flight and the next waits", async () => {
		await setConcurrency(2);
		try {
			const [a, b, c] = [newKey(), newKey(), newKey()];
			await fire(a, { hold: true });
			await fire(b, { hold: true });
			await saw(a, "start");
			await saw(b, "start");
			await fire(c);
			await Bun.sleep(500); // nothing to poll for: this is the run that must not start
			expect(count(c, "start")).toBe(0);

			await release(a);

			await saw(c, "end");
			await release(b);
			await saw(b, "end");
		} finally {
			await setConcurrency(10);
		}
	}, 60_000);

	it("a run past its timeout is recorded as failed, not cancelled, and is retried", async () => {
		const k = newKey();
		await ok200(paths.slow, { k });

		await until("all three attempts to start", () => count(k, "start") === 3, 30_000);
		const runs = await until(
			"all three attempts to be recorded",
			async () => {
				const recorded = await runsOf(slow);
				return recorded.length === 3 && recorded;
			},
			30_000,
		);

		expect(runs.map((run) => run.outcome)).toEqual(["failure", "failure", "failure"]);
		expect(count("all", "after")).toBe(0);
	}, 90_000);
});
