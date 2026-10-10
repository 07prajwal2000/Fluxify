// Runtime system logs (#731) against a real Postgres: a failed recorded run
// appends a row, other log types still upsert, and a row goes with its run.
// The partial unique index and its ON CONFLICT predicate only mean something on
// the real database.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrateDB } from "../../../db/migration";

const IMAGE = "postgres:16-alpine";
const NAME = "fluxify-runtime-logs-pg-test";
let container: Docker.Container;
let sql: SQL;
let recordings: typeof import("../consumer");
let logs: typeof import("../../../lib/systemLogs");
let runs: typeof import("../../../api/v1/recordings/delete-runs/repository");

beforeAll(async () => {
	await docker.getContainer(NAME).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: IMAGE,
			name: NAME,
			Env: ["POSTGRES_PASSWORD=postgres"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(host) }] } },
			ExposedPorts: { "5432/tcp": {} },
		}),
	);
	container = started.container;
	const url = `postgres://postgres:postgres@127.0.0.1:${started.port}/postgres`;
	for (let i = 0; ; i++) {
		const probe = new SQL(url, { max: 1 });
		try {
			await probe`SELECT 1`;
			break;
		} catch (error) {
			if (i >= 90) throw error;
			await Bun.sleep(500);
		} finally {
			await probe.close().catch(() => {});
		}
	}
	await migrateDB(url);
	sql = new SQL(url);
	mock.module("../../../db", () => ({ db: drizzle({ client: sql }) }));
	recordings = await import("../consumer");
	logs = await import("../../../lib/systemLogs");
	runs = await import("../../../api/v1/recordings/delete-runs/repository");

	await sql`INSERT INTO projects (id, name, slug) VALUES ('p1', 'Shop', 'shop')`;
	await sql`INSERT INTO routes (id, project_id, record_execution) VALUES ('r1', 'p1', true), ('r2', 'p1', true), ('r3', 'p1', true)`;
	await sql`INSERT INTO workflows (id, project_id, record_execution) VALUES ('w1', 'p1', true)`;
}, 180_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

function failedRun(overrides: Partial<TraceRunPayload> = {}): TraceRunPayload {
	return {
		runId: crypto.randomUUID(),
		projectId: "p1",
		routeId: "r1",
		routeVersion: "v1",
		method: "GET",
		path: "/x",
		startedAtWallMs: Date.now(),
		perfOrigin: 0,
		endedAt: 10,
		outcome: "failure",
		statusCode: 500,
		spans: [
			{ seq: 0, blockId: "entry", blockType: "entrypoint", startedAt: 0, endedAt: 1, outcome: "success" },
			{
				seq: 1,
				blockId: "js-1",
				blockType: "jsrunner",
				blockName: "Compute",
				startedAt: 1,
				endedAt: 9,
				outcome: "failure",
				error: "Error: boom",
				stack: "at run (fluxify-graph:3:9)",
			},
		],
		...overrides,
	} as TraceRunPayload;
}

const runtimeLogs = (resourceId: string) =>
	sql`SELECT * FROM system_logs WHERE type = 'runtime' AND resource_id = ${resourceId} ORDER BY id`;

describe("runtime system logs", () => {
	it("appends one row per failed run, with the failing block, stack and run id", async () => {
		const first = failedRun();
		const second = failedRun({ env: "development" });
		await recordings.persistRecording(first);
		await recordings.persistRecording(second);

		const rows = await runtimeLogs("r1");
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			project_id: "p1",
			resource_type: "route",
			resource_id: "r1",
			level: "error",
			message: "Error: boom",
			run_id: first.runId,
			detail: {
				runId: first.runId,
				// a run published by an older worker carries no env
				env: "production",
				block: { id: "js-1", type: "jsrunner", name: "Compute" },
				stack: "at run (fluxify-graph:3:9)",
				statusCode: 500,
			},
		});
		expect(rows[1]!.run_id).toBe(second.runId);
		expect(rows[1]!.detail.env).toBe("development");
	});

	it("writes a redelivered run's log once", async () => {
		const run = failedRun({ routeId: "r2" });
		await recordings.persistRecording(run);
		await recordings.persistRecording(run);

		expect(await runtimeLogs("r2")).toHaveLength(1);
	});

	it("logs a failed workflow run", async () => {
		await recordings.persistRecording(failedRun({ routeId: undefined, workflowId: "w1" }));

		const [row] = await runtimeLogs("w1");
		expect(row).toMatchObject({ resource_type: "workflow", resource_id: "w1" });
	});

	it("logs nothing for a successful run or a test run", async () => {
		await recordings.persistRecording(failedRun({ routeId: "r3", outcome: "success" }));
		await recordings.persistRecording(
			failedRun({
				routeId: "r3",
				metadata: {
					source: "test",
					label: "case",
					testRunId: "t1",
					suiteId: "s1",
					suiteName: "suite",
					caseIndex: 0,
					caseName: "case",
				},
			}),
		);

		expect(await runtimeLogs("r3")).toHaveLength(0);
	});

	it("keeps upserting every other type: one row per resource", async () => {
		const entry = { projectId: "p1", resourceType: "route", resourceId: "r1", type: "compile" };
		await logs.systemLog.info({ ...entry, message: "compiled" });
		await logs.systemLog.error({ ...entry, message: "failed to compile" });

		const rows = await sql`SELECT * FROM system_logs WHERE type = 'compile' AND resource_id = 'r1'`;
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ level: "error", message: "failed to compile" });
	});

	it("deleting a route's recordings deletes its runtime logs", async () => {
		expect((await runtimeLogs("r1")).length).toBeGreaterThan(0);

		await runs.deleteRecordedRuns("p1", { type: "route", id: "r1" });

		expect(await runtimeLogs("r1")).toHaveLength(0);
		// the compile row is not a run's
		expect(await sql`SELECT 1 FROM system_logs WHERE type = 'compile' AND resource_id = 'r1'`).toHaveLength(1);
	});

	it("retention deletes the logs of expired runs only", async () => {
		const day = 24 * 60 * 60_000;
		const old = failedRun({ routeId: "r2", startedAtWallMs: Date.now() - 40 * day });
		const fresh = failedRun({ routeId: "r2" });
		await recordings.persistRecording(old);
		await recordings.persistRecording(fresh);

		await recordings.deleteExpiredRecordings(30);

		const kept = (await runtimeLogs("r2")).map((row) => row.run_id);
		expect(kept).toContain(fresh.runId);
		expect(kept).not.toContain(old.runId);
	});
});
