// A production and a development worker on one real NATS (#732). Each takes only
// its own environment's jobs, schedule fires, internal trigger events and test
// runs, and a development worker holds no license slot. Names alone prove
// nothing here: the work-queue streams refusing overlapping consumers, and a
// schedule firing into the right stream, only happen on the broker.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { closeNats, connectNats, type QueueConsumer, type RpcResponder } from "@fluxify/common/nats";
import type { NodeEntitlement } from "@fluxify/common/orchestrator";
import type Docker from "dockerode";
import type { FluxifyEnv } from "../../lib/env";

process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
// The suite child is not what is under test; the responder that picks the suite up is.
mock.module("../../modules/testRunner/spawn", () => ({
	runSuiteInChild: async (_bootstrap: unknown, entry: string) => ({ ok: true, ranOn: entry }),
}));

const { createJobWorker } = await import("../../modules/jobs/consumer");
const { enqueueJob } = await import("../../modules/jobs/publisher");
const { TriggerWorker } = await import("../../modules/triggers/consumers");
const { fireInternalTrigger } = await import("../../modules/triggers/publisher");
const { startFireConsumer } = await import("../../modules/schedules/fire");
const { ensureSchedulesStream, removeSchedule, upsertSchedule } = await import("../../modules/schedules/reconciler");
const { serveTestRuns } = await import("../../modules/testRunner/workerHost");
const { runSuiteOnWorker } = await import("../../modules/testRunner/dispatch");
const { claimNodeSlot } = await import("../../modules/orchestrator/node");
const { devWorkerOnline } = await import("../../modules/orchestrator/status");

const IMAGE = "nats:2.14";
const NAME = "fluxify-dev-namespace-test";
const ENVS: FluxifyEnv[] = ["production", "development"];
const PROJECT = "p1";
let container: Docker.Container;
const stops: Array<() => Promise<unknown>> = [];
/** what each environment's worker received, as `<env> <target>` */
const seen: string[] = [];

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
			await ensureSchedulesStream("production");
			break;
		} catch (error) {
			await closeNats();
			if (i >= 60) throw error;
			await Bun.sleep(500);
		}
	}

	// Both workers serve the same project, side by side, as Kit runs them.
	for (const env of ENVS) {
		const record = async (job: { target: string }) => void seen.push(`${env} ${job.target}`);
		const jobs = createJobWorker({ mode: "both", env, handle: record });
		await jobs.serve(PROJECT);
		const triggers = new TriggerWorker({ projectId: PROJECT, env, run: record });
		await triggers.start();
		const fires: QueueConsumer = await startFireConsumer({ projectId: PROJECT, env });
		const tests: RpcResponder = serveTestRuns(PROJECT, env, env);
		stops.push(jobs.stop, () => triggers.stop(), fires.stop, tests.stop);
	}
}, 120_000);

afterAll(async () => {
	await Promise.allSettled(stops.map((stop) => stop()));
	await closeNats().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

async function until(done: () => boolean, ms = 10_000) {
	const deadline = Date.now() + ms;
	while (!done()) {
		if (Date.now() > deadline) throw new Error(`timed out; saw ${JSON.stringify(seen)}`);
		await Bun.sleep(50);
	}
}

/** Each environment's worker got exactly its own copy of `kind`, and nothing else. */
async function expectSplit(kind: string) {
	const mine = () => seen.filter((entry) => entry.endsWith(`${kind}-production`) || entry.endsWith(`${kind}-development`));
	await until(() => mine().length >= 2);
	await Bun.sleep(300);
	expect(mine().sort()).toEqual([`development ${kind}-development`, `production ${kind}-production`]);
}

describe("development namespace", () => {
	it("hands each environment's queued job only to that environment's worker", async () => {
		for (const env of ENVS)
			await enqueueJob({ kind: "workflow", projectId: PROJECT, target: `job-${env}` }, env);
		await expectSplit("job");
	});

	it("hands each environment's internal trigger only to that environment's worker", async () => {
		for (const env of ENVS)
			await fireInternalTrigger({ projectId: PROJECT, workflowId: `trigger-${env}`, data: null }, env);
		await expectSplit("trigger");
	});

	it("fires each environment's schedule into that environment's worker", async () => {
		for (const env of ENVS)
			await upsertSchedule(
				{
					id: `t-${env}`,
					projectId: PROJECT,
					workflowId: `schedule-${env}`,
					schedule: "@every 1s",
					timezone: "UTC",
				},
				env,
			);
		try {
			await until(() => seen.filter((entry) => entry.includes(" schedule-")).length >= 4);
			const runs = seen.filter((entry) => entry.includes(" schedule-"));
			expect(runs.filter((entry) => entry !== "production schedule-production" && entry !== "development schedule-development")).toEqual([]);
			expect(new Set(runs)).toEqual(new Set(["production schedule-production", "development schedule-development"]));
		} finally {
			for (const env of ENVS) await removeSchedule(PROJECT, `t-${env}`, env);
		}
	});

	it("runs each environment's test suite on that environment's worker", async () => {
		const bootstrap = { projectId: PROJECT, timeoutMs: 1_000 } as never;
		for (const env of ENVS)
			expect(await runSuiteOnWorker(bootstrap, env)).toMatchObject({ ok: true, ranOn: env });
	});
});

describe("license slots", () => {
	const COMMUNITY: NodeEntitlement = { maxReplicas: 1, types: ["both"], perProject: false };
	const claim = (nodeId: string, env: FluxifyEnv) =>
		claimNodeSlot({
			nodeId,
			projectId: "*",
			type: "both",
			groupIds: [],
			reserved: false,
			env,
			entitlement: () => COMMUNITY,
			onLost: () => {},
		});

	it("lets community run one production and one development worker, and no second production one", async () => {
		expect(await devWorkerOnline(PROJECT)).toBe(false);

		const prod = await claim("prod1", "production");
		const dev = await claim("dev01", "development");
		expect(prod.ok).toBe(true);
		expect(dev.ok).toBe(true);
		// the dev worker heartbeats like any other, so admin sees it
		expect(await devWorkerOnline(PROJECT)).toBe(true);

		const extra = await claim("prod2", "production");
		expect(extra.ok).toBe(false);
		if (!extra.ok) expect(extra.refusal.reason).toBe("no_license_slot");

		if (prod.ok) await prod.slot.release();
		if (dev.ok) await dev.slot.release();
		expect(await devWorkerOnline(PROJECT)).toBe(false);
	});
});
