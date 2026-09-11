import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
	QueueConnection,
	registerQueueConnector,
	type QueueBatch,
	type QueueHandler,
} from "@fluxify/adapters";
import { hydrateIntegrations, OWNER_KEY } from "../../../loaders/integrationsLoader";
import type { TriggerArtifact, WorkflowArtifact } from "../../compiler/artifacts";
import { applyArtifactUpdate } from "../../requestRouter/compiledRuntime";
import {
	applyQueueTrigger,
	hasQueueTrigger,
	refreshQueueTriggers,
	runBatch,
	shutdownQueueTriggers,
} from "../queueRuntime";

const PROJECT = "proj-q";

/** What the fake broker saw, and a way to push a batch through the handler. */
class FakeConnection extends QueueConnection {
	static last: FakeConnection | undefined;
	handler?: QueueHandler;
	commits: QueueBatch[] = [];
	deadLettered: unknown[] = [];
	stopped = false;
	failDLQ = false;

	constructor(readonly config: { secret: string }) {
		super();
		FakeConnection.last = this;
	}
	async consume(_subscription: unknown, handler: QueueHandler) {
		this.handler = handler;
	}
	async commit(batch: QueueBatch) {
		this.commits.push(batch);
	}
	async moveToDLQ(_batch: QueueBatch, error: unknown) {
		if (this.failDLQ) throw new Error("dead-letter topic unreachable");
		this.deadLettered.push(error);
	}
	async lag() {
		return 7;
	}
	async stop() {
		this.stopped = true;
	}
	raw() {
		return { client: "fake" };
	}
	deliver(batch = sampleBatch()) {
		return this.handler!(batch, this);
	}
}

function sampleBatch(): QueueBatch {
	return {
		events: [
			{
				data: { order: 1 },
				topic: "orders",
				partition: 0,
				offset: "41",
				key: "k1",
				headers: { trace: "abc" },
				timestamp: "2026-09-10T00:00:00.000Z",
			},
		],
		consumerGroup: "fluxify-t1",
		highWatermark: "50",
		attempt: 1,
	};
}

function trigger(overrides: Partial<TriggerArtifact> = {}): TriggerArtifact {
	return {
		triggerId: "t1",
		projectId: PROJECT,
		workflowId: "wf-q",
		groupId: "default",
		type: "fake",
		integrationId: "int-1",
		batchSize: 10,
		maxWaitMs: 500,
		maxBytes: 1024 * 1024,
		concurrency: 1,
		source: { topics: ["orders"] },
		maxAttempts: 2,
		retryDelayMs: 0,
		publishedAt: "2026-09-10T00:00:00.000Z",
		...overrides,
	};
}

/** A workflow whose body is `source`; it can see `ctx.vars.trigger`. */
function workflow(source: string) {
	applyArtifactUpdate("workflow.wf-q", {
		workflowId: "wf-q",
		projectId: PROJECT,
		projectName: "Queue Project",
		name: "Queue Workflow",
		timeoutSeconds: 30,
		tracingEnabled: false,
		recordExecution: false,
		workflowVersion: "2026-09-10T00:00:00.000Z",
		source,
		compiledAt: "2026-09-10T00:00:00.000Z",
	} satisfies WorkflowArtifact);
}

function credentials(secret: string, owner = PROJECT) {
	hydrateIntegrations(PROJECT, { db: { "int-1": { secret, [OWNER_KEY]: owner } } });
}

const seen = globalThis as { queueRuns?: number; queueTrigger?: any };

async function start(overrides: Partial<TriggerArtifact> = {}) {
	await applyQueueTrigger("t1", trigger(overrides));
	return FakeConnection.last!;
}

beforeAll(() => {
	registerQueueConnector("fake", async () => ({
		createConnection: (config) => new FakeConnection(config as { secret: string }),
	}));
});

afterEach(async () => {
	await shutdownQueueTriggers();
	FakeConnection.last = undefined;
	seen.queueRuns = 0;
	seen.queueTrigger = undefined;
	credentials("secret");
});

describe("an external queue batch", () => {
	it("runs the workflow with the connection and metadata, then commits", async () => {
		credentials("secret");
		workflow("globalThis.queueTrigger = ctx.vars.trigger; return { successful: true };");
		const connection = await start();

		await connection.deliver();

		expect(connection.commits).toHaveLength(1);
		const seenTrigger = seen.queueTrigger;
		expect(seenTrigger.source).toBe("fake");
		expect(seenTrigger.data[0].data).toEqual({ order: 1 });
		expect(seenTrigger.data[0].meta).toMatchObject({
			id: "orders:0:41",
			topic: "orders",
			partition: 0,
			offset: "41",
			key: "k1",
			headers: { trace: "abc" },
		});
		expect(seenTrigger.meta).toMatchObject({
			consumerGroup: "fluxify-t1",
			highWatermark: "50",
			attempt: 1,
		});
		expect(seenTrigger.connection.raw).toEqual({ client: "fake" });
		// a real client is cyclic; logging the trigger must not walk into it
		expect(JSON.parse(JSON.stringify(seenTrigger)).connection?.raw).toBeUndefined();
		expect(await seenTrigger.connection.lag()).toBe(7);
	});

	it("retries a failing run, then dead-letters and commits it in auto mode", async () => {
		credentials("secret");
		workflow("globalThis.queueRuns = (globalThis.queueRuns ?? 0) + 1; throw new Error('boom');");
		const connection = await start();

		await connection.deliver();

		expect(seen.queueRuns).toBe(2);
		expect(connection.deadLettered).toHaveLength(1);
		expect(String(connection.deadLettered[0])).toContain("boom");
		expect(connection.commits).toHaveLength(1);
	});

	it("counts an unsuccessful result as a failure", async () => {
		credentials("secret");
		workflow("return { successful: false, error: 'unhandled' };");
		const connection = await start({ maxAttempts: 1 });

		await connection.deliver();

		expect(String(connection.deadLettered[0])).toContain("unhandled");
	});

	it("never commits a batch it could not dead-letter", async () => {
		credentials("secret");
		workflow("throw new Error('boom');");
		const connection = await start({ maxAttempts: 1 });
		connection.failDLQ = true;

		await expect(connection.deliver()).rejects.toThrow("dead-letter topic unreachable");
		expect(connection.commits).toEqual([]);
	});

	it("leaves committing to the workflow in manual mode", async () => {
		credentials("secret");
		workflow("await ctx.vars.trigger.connection.commit(); return { successful: true };");
		const connection = await start({ commitMode: "manual" });

		await connection.deliver();

		// the workflow's own commit, and no automatic second one
		expect(connection.commits).toHaveLength(1);
	});

	it("hands a manual batch that keeps failing back to the connector", async () => {
		credentials("secret");
		workflow("throw new Error('boom');");
		const connection = await start({ commitMode: "manual" });

		await expect(connection.deliver()).rejects.toThrow("boom");
		expect(connection.commits).toEqual([]);
		expect(connection.deadLettered).toEqual([]);
	});

	it("does not spend attempts while its workflow is not loaded", async () => {
		credentials("secret");
		workflow("return { successful: true };");
		const connection = await start({ workflowId: "wf-missing" });

		await expect(connection.deliver()).rejects.toThrow("not loaded");
		expect(connection.commits).toEqual([]);
		expect(connection.deadLettered).toEqual([]);
	});

	it("refuses a batch for a trigger that was withdrawn", async () => {
		await expect(
			runBatch("gone", sampleBatch(), new FakeConnection({ secret: "x" })),
		).rejects.toThrow("no longer running");
	});
});

describe("an external queue trigger's lifecycle", () => {
	it("stops when its artifact is withdrawn", async () => {
		credentials("secret");
		const connection = await start();

		await applyQueueTrigger("t1", null);

		expect(connection.stopped).toBe(true);
		expect(hasQueueTrigger("t1")).toBe(false);
	});

	it("restarts on rotated credentials and stops when they are gone", async () => {
		credentials("secret");
		const first = await start();

		credentials("rotated");
		await refreshQueueTriggers();
		const second = FakeConnection.last!;
		expect(first.stopped).toBe(true);
		expect(second.config.secret).toBe("rotated");

		hydrateIntegrations(PROJECT, { db: {} });
		await refreshQueueTriggers();
		expect(second.stopped).toBe(true);
		expect(hasQueueTrigger("t1")).toBe(false);
	});

	it("will not borrow another project's integration", async () => {
		credentials("secret", "someone-else");
		await start();
		expect(hasQueueTrigger("t1")).toBe(false);
	});

	it("leaves internal triggers to the supervisor", async () => {
		credentials("secret");
		await applyQueueTrigger("t1", trigger({ type: "internal" }));
		expect(hasQueueTrigger("t1")).toBe(false);
	});
});
