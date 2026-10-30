// Trigger Workflow concurrency (#1038) against a real NATS: how many block-fired
// runs a project has in flight, a limit that changes while runs are going, a
// run longer than the ack wait, and a dead worker's run coming back. The run
// handler is ours, so a gate decides how long each run lasts.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { closeNats, connectNats } from "@fluxify/common/nats";
import { jetstream, jetstreamManager } from "@nats-io/jetstream";
import type Docker from "dockerode";
import { natsConnection } from "../../../db/nats";
import type { JobEnvelope } from "../../jobs/types";
import { TriggerWorker } from "../consumers";
import { fireInternalTrigger } from "../publisher";
import { internalConsumerName, TRIGGERS_STREAM } from "../subjects";

const IMAGE = "nats:2.14";
const NAME = "fluxify-trigger-concurrency-test";
const ACK_WAIT_MS = 2_000;

let container: Docker.Container;
const workers: TriggerWorker[] = [];
const gates: Array<() => void> = [];

/** a project of its own per test, so tests sharing the container cannot collide */
const newProject = () => `conc${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;

beforeAll(async () => {
	await docker.getContainer(NAME).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: NAME,
			Cmd: ["-js"],
			HostConfig: { PortBindings: { "4222/tcp": [{ HostPort: String(port) }] } },
			ExposedPorts: { "4222/tcp": {} },
		}),
	);
	container = started.container;
	for (let i = 0; ; i++) {
		try {
			const nc = await connectNats({ servers: `nats://127.0.0.1:${started.port}` });
			// JetStream answering, not merely the port accepting
			await (await jetstreamManager(nc)).getAccountInfo();
			break;
		} catch (error) {
			await closeNats();
			if (i >= 60) throw error;
			await Bun.sleep(500);
		}
	}
}, 120_000);

afterAll(async () => {
	for (const open of gates) open();
	await Promise.allSettled(workers.map((worker) => worker.stop()));
	await closeNats().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
}, 30_000);

async function until(done: () => boolean | Promise<boolean>, what: string, ms = 20_000) {
	const deadline = Date.now() + ms;
	while (!(await done())) {
		if (Date.now() > deadline) throw new Error(`timed out on ${what}`);
		await Bun.sleep(25);
	}
}

/** Runs that start and wait on a gate; `release(k)` lets run k finish. */
function harness(projectId: string, options: { concurrency?: number; ackWaitMs?: number } = {}) {
	const started: string[] = [];
	const finished: string[] = [];
	const open = new Map<string, () => void>();
	const run = async (job: JobEnvelope) => {
		const batch = job.payload as { events: Array<{ data: { k: string } }> };
		const k = batch.events[0]!.data.k;
		started.push(k);
		await new Promise<void>((resolve) => {
			open.set(k, resolve);
			gates.push(resolve);
		});
		finished.push(k);
	};
	const worker = new TriggerWorker({
		projectId,
		run,
		retryDelayMs: 500,
		defaultAckWaitMs: options.ackWaitMs,
		projectSettings: () =>
			options.concurrency === undefined
				? undefined
				: { "settings.workflows.triggerConcurrency": String(options.concurrency) },
	});
	workers.push(worker);
	return {
		worker,
		started,
		finished,
		release: (k: string) => open.get(k)?.(),
	};
}

const fire = (projectId: string, k: string) =>
	fireInternalTrigger({ projectId, workflowId: "wf", data: { k }, runKey: k });

async function consumerInfo(projectId: string) {
	const jsm = await jetstreamManager(natsConnection());
	return jsm.consumers.info(TRIGGERS_STREAM, internalConsumerName(projectId));
}

describe("Trigger Workflow concurrency", () => {
	it("runs the limit at once, and the next run waits for a free slot", async () => {
		const project = newProject();
		const h = harness(project, { concurrency: 2 });
		await h.worker.start();

		for (const k of ["a", "b", "c"]) await fire(project, k);
		await until(() => h.started.length === 2, "two runs started");
		await Bun.sleep(400);
		expect(h.started).toEqual(["a", "b"]);

		h.release("a");
		await until(() => h.started.includes("c"), "the third run starting once a slot freed");
		expect(h.started).toHaveLength(3);
		expect((await consumerInfo(project)).config.max_ack_pending).toBe(2);
	}, 60_000);

	it("one run at a time keeps the order", async () => {
		const project = newProject();
		const h = harness(project, { concurrency: 1 });
		await h.worker.start();

		for (const k of ["a", "b", "c"]) await fire(project, k);
		for (const k of ["a", "b", "c"]) {
			await until(() => h.started.length === ["a", "b", "c"].indexOf(k) + 1, `${k} starting`);
			expect(h.started.at(-1)).toBe(k);
			h.release(k);
		}
		await until(() => h.finished.length === 3, "all three finished");
		expect(h.finished).toEqual(["a", "b", "c"]);
	}, 60_000);

	it("a raised limit starts waiting runs with no restart, and leaves running ones alone", async () => {
		const project = newProject();
		const h = harness(project, { concurrency: 1 });
		await h.worker.start();

		for (const k of ["a", "b", "c"]) await fire(project, k);
		await until(() => h.started.length === 1, "first run");
		await Bun.sleep(300);
		expect(h.started).toEqual(["a"]);

		// the way a worker learns of it: the project's settings arrive changed
		h.worker.projectSettingsChanged(project, { "settings.workflows.triggerConcurrency": "3" });

		await until(() => h.started.length === 3, "the waiting runs starting");
		expect(h.finished).toEqual([]);
		await until(async () => (await consumerInfo(project)).config.max_ack_pending === 3, "the broker limit");
	}, 60_000);

	it("a lowered limit never interrupts a run, and holds new ones until enough finish", async () => {
		const project = newProject();
		const h = harness(project, { concurrency: 3 });
		await h.worker.start();

		for (const k of ["a", "b", "c"]) await fire(project, k);
		await until(() => h.started.length === 3, "three running");

		await h.worker.setInternalConcurrency(project, 1);
		for (const k of ["d", "e"]) await fire(project, k);
		await Bun.sleep(500);
		expect(h.started).toHaveLength(3);
		expect(h.finished).toEqual([]);
		expect((await consumerInfo(project)).config.max_ack_pending).toBe(1);

		h.release("a");
		h.release("b");
		await Bun.sleep(500);
		// two finished, one still running: at the limit, so d still waits
		expect(h.started).toHaveLength(3);

		h.release("c");
		await until(() => h.started.includes("d"), "d starting once the pool drained");
		expect(h.started).not.toContain("e");
	}, 60_000);

	it("leaves the broker's limit alone while the project's settings are not known yet", async () => {
		const project = newProject();
		const first = harness(project, { concurrency: 7 });
		await first.worker.start();
		expect((await consumerInfo(project)).config.max_ack_pending).toBe(7);

		// a worker that has not received the config yet must not write its default over it
		const second = harness(project, { concurrency: undefined });
		await second.worker.start();
		expect((await consumerInfo(project)).config.max_ack_pending).toBe(7);
	}, 60_000);
});

describe("Trigger Workflow keep-alive", () => {
	it("does not redeliver a run that outlasts the ack wait", async () => {
		const project = newProject();
		const h = harness(project, { concurrency: 2, ackWaitMs: ACK_WAIT_MS });
		await h.worker.start();

		await fire(project, "long");
		await until(() => h.started.length === 1, "the run starting");
		// well past the ack wait: without a beat the broker would have handed it out again
		await Bun.sleep(ACK_WAIT_MS * 2 + 500);
		expect(h.started).toEqual(["long"]);

		h.release("long");
		await until(() => h.finished.length === 1, "the run finishing");
		const info = await consumerInfo(project);
		await until(async () => (await consumerInfo(project)).num_ack_pending === 0, "the ack");
		expect(info.config.ack_wait).toBe(ACK_WAIT_MS * 1_000_000);
		expect(h.started).toEqual(["long"]);
	}, 60_000);

	it("redelivers a run whose worker died holding it", async () => {
		const project = newProject();
		const first = harness(project, { concurrency: 2, ackWaitMs: ACK_WAIT_MS });
		await first.worker.start();
		await first.worker.stop();

		await fire(project, "orphan");
		// the dead worker: it pulled the message and never acked or beat
		const js = jetstream(natsConnection());
		const consumer = await js.consumers.get(TRIGGERS_STREAM, internalConsumerName(project));
		const taken = await consumer.fetch({ max_messages: 1, expires: 2_000 });
		let held = 0;
		for await (const _ of taken) held++;
		expect(held).toBe(1);

		const second = harness(project, { concurrency: 2, ackWaitMs: ACK_WAIT_MS });
		await second.worker.start();
		await until(() => second.started.includes("orphan"), "the orphaned run coming back", 30_000);
		expect(second.started).toEqual(["orphan"]);
	}, 60_000);
});
