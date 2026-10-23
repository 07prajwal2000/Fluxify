// Plugin triggers (T3) end to end: a real Postgres and NATS behind the plugins
// and triggers API, a real worker install, and two real execution processes of
// one group running the installed trigger. The trigger is a Postgres poller that
// claims a row with `FOR UPDATE SKIP LOCKED`, emits it with a connection whose
// `commit` the workflow calls, and marks the row done only once `emit`
// resolved, all in the claim's transaction. Every row must run to a commit
// exactly once, even when a worker is killed in the middle of a run.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { faker } from "@faker-js/faker";
import { compileGraph } from "@fluxify/blocks";
import { param } from "@fluxify/sdk/blocks";
import { toTriggerEntry, trigger } from "@fluxify/sdk/triggers";

// the admin's change broadcast is Redis pub/sub, which nothing here listens to
const redis = { ...(await import("../../../../db/redis")) };
mock.module("../../../../db/redis", () => ({ ...redis, publishMessage: async () => {} }));

const { pluginStatusKey } = await import("@fluxify/common/orchestrator");
const { setup, startStack, stopStack } = await import("../../sources/tests/stack");
const { pluginTgz } = await import("../../sources/tests/tarball");
const { startWorker, until } = await import("./worker");
const natsKv = await import("../../../../db/natsKv");
const { projectConfigKey, triggerKey, workflowKey } = await import("../../../compiler/subjects");
const { createExecutionSupervisor } = await import(
	"../../../requestRouter/executionSupervisor"
);
const triggersApi = (await import("../../../../api/v1/triggers/register")).default;
const { applyArtifactUpdate } = await import("../../../requestRouter/compiledRuntime");
const { setPluginTriggerRefs } = await import("../../../requestRouter/pluginTriggers");
const { applyPluginTrigger } = await import("../../../triggers/pluginTriggerRuntime");
const { registerWorkflowJobHandler } = await import("../../../jobs/workflowJob");
const { WorkflowTraceRecorder } = await import("../../../telemetry/routeRecorder");
const { persistRecording } = await import("../../../recordings/consumer");

const NAME = "acme/pg";
const KIND = `${NAME}/poller`;
const ROWS = 30;
let sql: Awaited<ReturnType<typeof startStack>>["sql"];
let url: string;

beforeAll(async () => {
	({ sql, url } = await startStack("trigger-runtime", [triggersApi as never]));
}, 240_000);
afterAll(stopStack);

/** the manifest side of the poller; its code is `POLLER` */
const definition = trigger({
	name: KIND,
	label: "Poller",
	icon: "data:image/svg+xml;base64,PHN2Zy8+",
	params: {
		table: param.string({ required: true }),
		dsn: param.secret({ required: true }),
		everyMs: param.number({ default: 20 }),
	},
	start: async () => async () => {},
});

// What an author ships: imports the host's SDK, brings its own client, owns delivery.
const POLLER = `import { SQL } from "bun";
import { param } from "@fluxify/sdk/blocks";
import { trigger } from "@fluxify/sdk/triggers";

export default trigger({
	name: "${KIND}",
	label: "Poller",
	icon: "./poller.svg",
	params: {
		table: param.string({ required: true }),
		dsn: param.secret({ required: true }),
		everyMs: param.number({ default: 20 }),
	},
	async start(ctx) {
		const sql = new SQL(String(ctx.getConfig(ctx.params.dsn)), { max: 4 });
		const table = ctx.params.table;
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const claimOne = () =>
			sql.begin(async (tx) => {
				const [row] = await tx.unsafe(
					\`SELECT id, payload FROM \${table} WHERE NOT done ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED\`,
				);
				if (!row) return false;
				// outside the claim, so it survives this worker being killed
				await sql.unsafe(\`INSERT INTO \${table}_claims (job_id, pid) VALUES ($1, $2)\`, [row.id, process.pid]);
				await ctx.emit([{ id: row.id, payload: row.payload }], {
					connection: {
						raw: tx,
						commit: () => tx.unsafe(\`UPDATE \${table} SET commits = commits + 1 WHERE id = $1\`, [row.id]).then(() => {}),
						moveToDLQ: async () => {},
						lag: async () => null,
					},
				});
				await tx.unsafe(\`UPDATE \${table} SET done = true, pid = $2 WHERE id = $1\`, [row.id, process.pid]);
				return true;
			});
		const loop = (async () => {
			while (!ctx.signal.aborted) if (!(await claimOne())) await wait(ctx.params.everyMs);
		})().catch((error) => ctx.fail(error));
		return async () => {
			await loop;
			await sql.close();
		};
	},
});
`;

const pollerTgz = (version: string) =>
	pluginTgz({
		"package.json": JSON.stringify({
			name: "@acme/pg",
			version,
			fluxify: { name: NAME, url: "https://github.com/acme/fluxify-pg" },
		}),
		"bun.lock": "{}",
		"fluxify.json": JSON.stringify({
			name: NAME,
			url: "https://github.com/acme/fluxify-pg",
			sdk: ">=2026.10.0",
			blocks: {},
			triggers: [{ ...toTriggerEntry(definition), entry: "dist/triggers/poller.js" }],
		}),
		"dist/triggers/poller.js": POLLER,
		"dist/blocks/step.js": null,
	} as never);

/** a JS block: checks it was handed one row, holds it a moment, then commits through the trigger */
function workflowArtifact(project: string, workflowId: string) {
	const { source } = compileGraph(
		[
			{ id: "entry", type: "entrypoint", position: { x: 0, y: 0 }, data: {} },
			{
				id: "commit",
				type: "jsrunner",
				position: { x: 240, y: 0 },
				data: {
					value: `if (trigger.data.length !== 1 || typeof trigger.data[0].data.id !== "number") throw new Error("no row");
await new Promise((r) => setTimeout(r, 40));
await trigger.connection.commit();
return trigger.data[0].data.id;`,
				},
			},
			{ id: "done", type: "response", position: { x: 480, y: 0 }, data: { httpCode: "200" } },
		] as never,
		[
			{ id: "e1", from: "entry", to: "commit", fromHandle: "source", toHandle: "source" },
			{ id: "e2", from: "commit", to: "done", fromHandle: "source", toHandle: "source" },
		] as never,
		{ asWorkflow: true },
	);
	const now = new Date().toISOString();
	return {
		workflowId,
		projectId: project,
		projectName: "pg",
		name: "commit rows",
		timeoutSeconds: 30,
		tracingEnabled: false,
		recordExecution: false,
		workflowVersion: now,
		source,
		compiledAt: now,
	};
}

describe("plugin triggers: the runtime", () => {
	it("a Postgres poller on two workers of one group runs every row exactly once, even when a worker dies mid-run", async () => {
		const s = await setup();
		expect((await s.upload(pollerTgz("2026.10.2001"))).status).toBe(200);
		expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
		expect((await s.put(`/${NAME}/environments`, { dev: true, prod: false })).status).toBe(200);
		const workflowId = Bun.randomUUIDv7();
		await sql`INSERT INTO workflows (id, name, project_id) VALUES (${workflowId}, 'wf', ${s.project})`;

		const table = `jobs_${faker.string.alpha({ length: 8, casing: "lower" })}`;
		await sql.unsafe(
			`CREATE TABLE ${table} (id serial PRIMARY KEY, payload text, done boolean NOT NULL DEFAULT false, commits int NOT NULL DEFAULT 0, pid int)`,
		);
		await sql.unsafe(`CREATE TABLE ${table}_claims (job_id int, pid int, at timestamptz DEFAULT now())`);
		for (let i = 0; i < ROWS; i++) await sql.unsafe(`INSERT INTO ${table} (payload) VALUES ($1)`, [`row ${i}`]);

		const created = await s.api("POST", "/triggers", {
			name: `t-${faker.string.alphanumeric(8)}`,
			type: `plugin:${KIND}`,
			projectId: s.project,
			workflowId,
			active: true,
			source: { table, dsn: "cfg:PG_URL" },
		});
		expect(created.status).toBe(200);
		const id = created.body.id as string;
		const published = await natsKv.getArtifact<any>(triggerKey(s.project, id), "development");
		expect(published.plugin.kind).toBe(KIND);

		const worker = await startWorker(s.project, "development");
		const supervisors: ReturnType<typeof createExecutionSupervisor>[] = [];
		try {
			await until(
				() => worker.status(),
				(status) => status[pluginStatusKey(s.project, NAME)]?.state === "ready",
			);
			const artifacts = [
				{
					key: projectConfigKey(s.project),
					value: {
						projectId: s.project,
						compiledAt: new Date().toISOString(),
						payload: {
							appConfig: { PG_URL: url },
							dbIntegrations: {},
							kvIntegrations: {},
							observabilityIntegrations: {},
							aiIntegrations: {},
							projectSettings: {},
						},
					},
				},
				{ key: workflowKey(s.project, workflowId), value: workflowArtifact(s.project, workflowId) },
				{ key: triggerKey(s.project, id), value: published },
			];
			// two workers of the trigger's group: each runs the real execution process
			for (let i = 0; i < 2; i++) {
				const supervisor = createExecutionSupervisor({
					projectId: s.project,
					port: 20_000 + Math.floor(Math.random() * 12_000),
					entry: new URL("../../../requestRouter/executionProcess.ts", import.meta.url),
					databaseIdleTimeoutMs: 5_000,
					asyncExecutor: { maxInFlight: 1, maxQueueDepth: 1, drainTimeoutMs: 2_000 },
					maxRequestBodyBytes: 1_024,
					scheduleHorizonMs: 1_000,
					logging: { level: "warn", otlpEndpoint: "", otlpHeaders: {}, useOtlp: false },
					artifacts: () => artifacts,
					trustedOrigins: [],
					baseDomain: () => "",
					env: "development",
					timeoutsEnabled: () => false,
					pluginRefs: () => [],
					pluginTriggerRefs: () => worker.installer.triggerRefs(),
				});
				supervisor.start();
				supervisors.push(supervisor);
			}
			const pids = supervisors.map((sv) => (sv.child() as { pid: number }).pid);
			const claims = () => sql.unsafe(`SELECT job_id, pid FROM ${table}_claims`) as Promise<{ job_id: number; pid: number }[]>;
			const done = async () => Number((await sql.unsafe(`SELECT count(*) AS n FROM ${table} WHERE done`))[0].n);

			// both workers are taking rows
			for (let i = 0; i < 300; i++) {
				const by = new Set((await claims()).map((c) => c.pid));
				if (pids.every((pid) => by.has(pid))) break;
				await Bun.sleep(50);
			}
			// kill the first while it holds a row it has not finished
			for (let i = 0; i < 300; i++) {
				const open = await sql.unsafe(
					`SELECT c.job_id FROM ${table}_claims c JOIN ${table} j ON j.id = c.job_id WHERE c.pid = $1 AND NOT j.done`,
					[pids[0]],
				);
				if (open.length) break;
				await Bun.sleep(5);
			}
			supervisors[0]!.child()!.kill(9);

			for (let i = 0; i < 600 && (await done()) < ROWS; i++) await Bun.sleep(50);

			const rows = (await sql.unsafe(`SELECT id, done, commits, pid FROM ${table} ORDER BY id`)) as {
				done: boolean;
				commits: number;
				pid: number;
			}[];
			expect(rows).toHaveLength(ROWS);
			// every row committed by the workflow exactly once, and marked done after emit resolved
			expect(rows.every((r) => r.done && r.commits === 1)).toBe(true);
			// the killed worker's claim was rolled back and run again elsewhere
			const all = await claims();
			const reclaimed = all.filter(
				(c) => c.pid === pids[0] && rows.find((r, i) => i + 1 === c.job_id)?.pid !== pids[0],
			);
			expect(reclaimed.length).toBeGreaterThanOrEqual(1);
			// both workers did some of the work
			expect(new Set(rows.map((r) => r.pid)).size).toBeGreaterThanOrEqual(2);
		} finally {
			for (const supervisor of supervisors) {
				supervisor.stop();
				const child = supervisor.child();
				child?.kill();
				await child?.exited;
			}
			await worker.stop();
		}
	}, 180_000);

	it("a run started by a trigger with the longest allowed kind is recorded with its trigger source", async () => {
		const s = await setup();
		const workflowId = Bun.randomUUIDv7();
		await sql`INSERT INTO workflows (id, name, project_id, record_execution, dev_record_execution)
			VALUES (${workflowId}, 'wf', ${s.project}, true, true)`;
		// `plugin:` plus the longest name the manifest takes fills the trigger row's 255 characters
		const kind = `acme/pg/${"a".repeat(240)}`;
		const type = `plugin:${kind}`;
		expect(type).toHaveLength(255);

		const runs: any[] = [];
		registerWorkflowJobHandler({ start: (wf) => new WorkflowTraceRecorder(wf, (run) => runs.push(run)) });
		applyArtifactUpdate(workflowKey(s.project, workflowId), {
			...workflowArtifact(s.project, workflowId),
			recordExecution: true,
		});
		const entry = join(mkdtempSync(join(tmpdir(), "fx-long-kind-")), "t.js");
		writeFileSync(
			entry,
			`export default { name: "${kind}", start: async (ctx) => {
	ctx.emit([{ id: 7 }], { connection: { raw: null, commit: async () => {}, moveToDLQ: async () => {}, lag: async () => null } });
	return async () => {};
} };
`,
		);
		setPluginTriggerRefs([
			{
				projectId: s.project,
				plugin: NAME,
				version: "1.0.0",
				integrity: "sha512-long",
				kind,
				entry,
				permissions: { integrations: [], appconfig: false },
			},
		]);
		const triggerId = Bun.randomUUIDv7();
		await applyPluginTrigger(triggerId, {
			triggerId,
			projectId: s.project,
			workflowId,
			groupId: "default",
			type,
			integrationId: null,
			batchSize: 1,
			maxWaitMs: 0,
			maxBytes: 1024,
			concurrency: 1,
			source: {},
			plugin: { kind, name: NAME, version: "1.0.0", integrity: "sha512-long", retry: false },
			publishedAt: new Date().toISOString(),
		});
		try {
			const [run] = await until(() => runs, (r) => r.length > 0, 10_000);
			expect(run.outcome).toBe("success");
			expect(await persistRecording(run)).toBe("stored");
			const [stored] = await sql`SELECT r.outcome, s.input FROM trace_runs r JOIN trace_spans s ON s.run_id = r.id
				WHERE r.id = ${run.runId} AND s.input -> 'trigger' IS NOT NULL`;
			expect(stored.outcome).toBe("success");
			expect(stored.input.trigger).toMatchObject({ id: triggerId, type });
			expect(stored.input.trigger.events[0]).toMatchObject({ source: type, attempt: 1 });
		} finally {
			await applyPluginTrigger(triggerId, null);
		}
	}, 60_000);
});
