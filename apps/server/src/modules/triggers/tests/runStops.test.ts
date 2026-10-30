// Stopping a run (#1033) as a user wires it: real NATS, two real execution
// processes running compiled graphs with Trigger Workflow blocks. One holds the
// runs; a Stop a run block on the other reaches them only through the bucket.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { compileGraph } from "@fluxify/blocks";
import { closeNats, connectNats, type KvWatcher, openKvBucket } from "@fluxify/common/nats";
import type Docker from "dockerode";
import { natsConnection, natsName } from "../../../db/nats";
import { projectConfigKey, workflowKey } from "../../compiler/subjects";
import { STOP_TTL_MS, stopKey } from "../../jobs/runStops";
import type { JobEnvelope } from "../../jobs/types";
import { createExecutionSupervisor } from "../../requestRouter/executionSupervisor";
import { TriggerWorker } from "../consumers";
import { clearRunStop, putRunStop, RUN_STOPS_BUCKET, watchRunStops } from "../runStopBucket";

const IMAGE = "nats:2.14";
const NAME = "fluxify-run-stops-test";
const PROJECT = "stops";
const TARGET = "target";
const FIRE = "fire";
const STOP = "stop";
const RETRY_DELAY_MS = 2_000;

let container: Docker.Container;
const ports: number[] = [];
let events: string[] = [];
const holds = new Map<string, () => void>();
const server = Bun.serve({
	port: 0,
	fetch(request) {
		const url = new URL(request.url);
		const k = url.searchParams.get("k")!;
		if (url.pathname === "/ev") {
			events.push(`${k} ${url.searchParams.get("e")}`);
			return new Response("ok");
		}
		// answered when the test says so: the graph sits here, ignoring the signal
		return new Promise<Response>((resolve) => holds.set(k, () => resolve(new Response("ok"))));
	},
});

const TARGET_JS = `const base = "http://127.0.0.1:${server.port}";
const k = encodeURIComponent(input.k);
const ev = (e) => fetch(base + "/ev?k=" + k + "&e=" + e);
await ev("start");
if (input.hold) await fetch(base + "/hold?k=" + k);
if (input.fail) { await ev("fail"); throw new Error("boom"); }
if (input.wait) await new Promise((r) => abortSignal.aborted ? r() : abortSignal.addEventListener("abort", r));
await ev("end");
return 1;`;

function artifact(workflowId: string, middle: { type: string; data: Record<string, unknown> }) {
	const { source } = compileGraph(
		[
			{ id: "entry", type: "entrypoint", position: { x: 0, y: 0 }, data: {} },
			{ id: "work", position: { x: 240, y: 0 }, ...middle },
			{ id: "done", type: "response", position: { x: 480, y: 0 }, data: { httpCode: "200" } },
		] as never,
		[
			{ id: "e1", from: "entry", to: "work", fromHandle: "source", toHandle: "source" },
			{ id: "e2", from: "work", to: "done", fromHandle: "source", toHandle: "source" },
		] as never,
		{ asWorkflow: true },
	);
	const now = new Date().toISOString();
	return {
		key: workflowKey(PROJECT, workflowId),
		value: {
			workflowId,
			projectId: PROJECT,
			projectName: "stops",
			name: workflowId,
			timeoutSeconds: 60,
			tracingEnabled: false,
			recordExecution: false,
			workflowVersion: now,
			source,
			compiledAt: now,
		},
	};
}

const artifacts = [
	{
		key: projectConfigKey(PROJECT),
		value: {
			projectId: PROJECT,
			compiledAt: new Date().toISOString(),
			payload: {
				appConfig: {},
				dbIntegrations: {},
				kvIntegrations: {},
				observabilityIntegrations: {},
				aiIntegrations: {},
				projectSettings: {},
			},
		},
	},
	artifact(TARGET, { type: "jsrunner", data: { value: TARGET_JS } }),
	artifact(FIRE, {
		type: "trigger_workflow",
		data: {
			mode: "now",
			workflowId: TARGET,
			useInput: true,
			runKey: "js: return input.k;",
			maxAttempts: 3,
			retryDelayMs: RETRY_DELAY_MS,
		},
	}),
	artifact(STOP, { type: "trigger_workflow", data: { mode: "stop", runKey: "js: return input.k;" } }),
];

function supervisorFor() {
	const port = 20_000 + Math.floor(Math.random() * 12_000);
	ports.push(port);
	const supervisor = createExecutionSupervisor({
		projectId: PROJECT,
		port,
		entry: new URL("../../requestRouter/executionProcess.ts", import.meta.url),
		databaseIdleTimeoutMs: 5_000,
		asyncExecutor: { maxInFlight: 1, maxQueueDepth: 1, drainTimeoutMs: 2_000 },
		maxRequestBodyBytes: 1_024,
		scheduleHorizonMs: 1_000,
		logging: { level: "warn", otlpEndpoint: "", otlpHeaders: {}, useOtlp: false },
		artifacts: () => artifacts as never,
		trustedOrigins: [],
		baseDomain: () => "",
		timeoutsEnabled: () => false,
	});
	supervisor.start();
	return supervisor;
}

/** A child binds its port only after registering its job handlers: until then a job is refused. */
async function childrenReady() {
	for (const port of ports)
		await until(
			() =>
				fetch(`http://127.0.0.1:${port}`).then(
					() => true,
					() => false,
				),
			`the child on ${port}`,
		);
}

/** holds the runs, and consumes and watches as a worker does */
let worker: ReturnType<typeof supervisorFor>;
/** "another process": its blocks fire and stop, nothing else */
let other: ReturnType<typeof supervisorFor>;
let triggers: TriggerWorker;
let watch: KvWatcher;

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
			await connectNats({ servers: `nats://127.0.0.1:${started.port}` });
			// JetStream answering, not merely the port accepting
			watch = await watchRunStops(PROJECT, (key, stop) => worker?.runStopChanged(key, stop));
			await watch.initialized;
			break;
		} catch (error) {
			await closeNats();
			if (i >= 60) throw error;
			await Bun.sleep(500);
		}
	}
	worker = supervisorFor();
	other = supervisorFor();
	await childrenReady();
	// one run at a time: "still queued" needs a run waiting behind another
	triggers = new TriggerWorker({
		projectId: PROJECT,
		run: worker.runJob,
		retryDelayMs: RETRY_DELAY_MS,
		projectSettings: () => ({ "settings.workflows.triggerConcurrency": "1" }),
	});
	await triggers.start();
}, 120_000);

afterAll(async () => {
	await watch?.stop();
	await triggers?.stop();
	for (const supervisor of [worker, other]) {
		supervisor?.stop();
		const child = supervisor?.child();
		child?.kill();
		await child?.exited;
	}
	server.stop(true);
	await closeNats().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
}, 30_000);

// not valid in a KV key, and wildcards in a subject: the bucket must cope
const newKey = () => `conv ${crypto.randomUUID()}/*>`;

/** runs a compiled graph on the other process, the way a route's block would */
function onOther(target: string, payload: unknown) {
	return other.runJob({
		id: crypto.randomUUID(),
		kind: "workflow",
		projectId: PROJECT,
		target,
		payload,
		enqueuedAt: new Date().toISOString(),
	} satisfies JobEnvelope);
}

const fire = (k: string, options: Record<string, boolean> = {}) => onOther(FIRE, { k, ...options });
const stop = (k: string) => onOther(STOP, { k });

async function until(done: () => boolean | Promise<boolean>, what: string, ms = 30_000) {
	const deadline = Date.now() + ms;
	while (!(await done())) {
		if (Date.now() > deadline) throw new Error(`timed out on ${what}; saw ${JSON.stringify(events)}`);
		await Bun.sleep(25);
	}
}

const saw = (k: string, event: string) => until(() => events.includes(`${k} ${event}`), `${k} ${event}`);
const count = (k: string, event: string) => events.filter((e) => e === `${k} ${event}`).length;

const bucket = () =>
	openKvBucket(natsConnection(), natsName(RUN_STOPS_BUCKET), { ttlMs: STOP_TTL_MS });

async function entry(k: string) {
	const found = await (await bucket()).store.get(stopKey(PROJECT, k));
	return found?.operation === "PUT" ? found : null;
}

const exists = (k: string) => until(async () => (await entry(k)) !== null, `the entry for ${k}`);
const gone = (k: string) => until(async () => (await entry(k)) === null, `no entry for ${k}`);

/** wait out the first retry, to prove nothing came back */
const pastRetry = () => Bun.sleep(RETRY_DELAY_MS + 1_500);

describe("Stop a run", () => {
	it("reaches a run in another process, which resolves and clears the entry", async () => {
		const k = newKey();
		await fire(k, { wait: true });
		await saw(k, "start");

		await stop(k);

		await saw(k, "end");
		await gone(k);
		await pastRetry();
		expect(count(k, "start")).toBe(1);
	}, 60_000);

	it("skips a run still queued, and clears the entry", async () => {
		const first = newKey();
		const queued = newKey();
		await fire(first, { hold: true });
		await saw(first, "start");
		await fire(queued);

		await stop(queued);
		await exists(queued);
		await until(() => holds.has(first), "the hold");
		holds.get(first)!();
		await saw(first, "end");

		await gone(queued);
		expect(count(queued, "start")).toBe(0);
	}, 60_000);

	it("skips a run waiting between retries, and clears the entry", async () => {
		const k = newKey();
		await fire(k, { fail: true });
		await saw(k, "fail");

		await stop(k);

		await gone(k);
		await pastRetry();
		expect(count(k, "start")).toBe(1);
	}, 60_000);

	it("does not retry a failure a stop arrived during, and clears the entry", async () => {
		const k = newKey();
		await fire(k, { hold: true, fail: true });
		await until(() => holds.has(k), "the hold");
		await stop(k);
		await exists(k);
		await Bun.sleep(200);

		holds.get(k)!();

		await saw(k, "fail");
		await gone(k);
		await pastRetry();
		expect(count(k, "start")).toBe(1);
	}, 60_000);

	it("clears the entry of a run that completed anyway", async () => {
		const k = newKey();
		await fire(k, { hold: true });
		await until(() => holds.has(k), "the hold");
		await stop(k);
		await exists(k);
		await Bun.sleep(200);

		holds.get(k)!();

		await saw(k, "end");
		await gone(k);
	}, 60_000);

	it("lets a later run reuse the id", async () => {
		const k = newKey();
		await fire(k, { wait: true });
		await saw(k, "start");
		await stop(k);
		await saw(k, "end");
		await gone(k);

		await fire(k);

		await until(() => count(k, "end") === 2, "the second run");
		expect(count(k, "start")).toBe(2);
	}, 60_000);

	it("is honoured by a restarted child", async () => {
		const k = newKey();
		await fire(k, { wait: true });
		await saw(k, "start");
		const before = worker.child() as unknown as { pid: number; kill(signal: number): void };

		before.kill(9);
		await putRunStop(PROJECT, k);

		await until(
			() => (worker.child() as unknown as { pid: number } | undefined)?.pid !== before.pid,
			"the new child",
		);
		await gone(k);
		await pastRetry();
		expect(count(k, "start")).toBe(1);
	}, 60_000);

	it("does not clear a stop older than the run", async () => {
		const k = newKey();
		await stop(k);
		await exists(k);
		const older = await entry(k);
		await Bun.sleep(50);

		await fire(k);

		await saw(k, "end");
		await Bun.sleep(500);
		expect((await entry(k))?.revision).toBe(older!.revision);
	}, 60_000);

	it("does not clear a newer stop when an older run ends", async () => {
		const k = newKey();
		await fire(k, { hold: true });
		await until(() => holds.has(k), "the hold");
		await stop(k);
		await exists(k);
		const first = await entry(k);
		await Bun.sleep(200);
		await putRunStop(PROJECT, k);
		await until(async () => (await entry(k))?.revision !== first!.revision, "the newer stop");
		const newer = await entry(k);
		await Bun.sleep(200);

		holds.get(k)!();

		await saw(k, "end");
		await Bun.sleep(500);
		expect((await entry(k))?.revision).toBe(newer!.revision);
	}, 60_000);

	it("does nothing for an id with no run", async () => {
		const k = newKey();
		await expect(stop(k)).resolves.toBeUndefined();
		await exists(k);
		expect(count(k, "start")).toBe(0);
	}, 60_000);
});

describe("the bucket", () => {
	it("deletes only at the revision it was given", async () => {
		const k = newKey();
		await putRunStop(PROJECT, k);
		const first = (await entry(k))!;
		await putRunStop(PROJECT, k);
		const second = (await entry(k))!;

		await clearRunStop(stopKey(PROJECT, k), first.revision);
		expect((await entry(k))?.revision).toBe(second.revision);

		await clearRunStop(stopKey(PROJECT, k), second.revision);
		expect(await entry(k)).toBeNull();
	});

	it("expires entries after 7 days", async () => {
		const status = await (await bucket()).store.status();
		expect(status.ttl).toBe(STOP_TTL_MS);
	});
});
