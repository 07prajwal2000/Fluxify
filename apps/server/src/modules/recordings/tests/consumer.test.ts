// Execution recordings (#254) against a real Postgres and a real NATS 2.14:
// the stream, the consumer, the tables and the retention delete, end to end.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import {
	closeNats,
	connectNats,
	natsConnection,
	publishToStream,
	type QueueConsumer,
} from "@fluxify/common/nats";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrateDB } from "../../../db/migration";
import { traceCompleter } from "../../requestRouter/traceLifecycle";
import { RouteTraceRecorder } from "../../telemetry/routeRecorder";

const PG = { image: "postgres:16-alpine", name: "fluxify-recordings-pg-test" };
const NATS = { image: "nats:2.14", name: "fluxify-recordings-nats-test" };
const containers: Docker.Container[] = [];
const consumers: QueueConsumer[] = [];
let sql: SQL;
let recordings: typeof import("../consumer");
let stream: typeof import("../stream");

async function start(spec: { image: string; name: string }, port: number, extra: object) {
	await docker.getContainer(spec.name).remove({ force: true }).catch(() => {});
	await pullImage(spec.image);
	const started = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: spec.image,
			name: spec.name,
			HostConfig: { PortBindings: { [`${port}/tcp`]: [{ HostPort: String(host) }] } },
			ExposedPorts: { [`${port}/tcp`]: {} },
			...extra,
		}),
	);
	containers.push(started.container);
	return started.port;
}

async function retry<T>(attempt: () => Promise<T>, tries = 90): Promise<T> {
	for (let i = 0; ; i++) {
		try {
			return await attempt();
		} catch (error) {
			if (i >= tries) throw error;
			await Bun.sleep(500);
		}
	}
}

beforeAll(async () => {
	const [pgPort, natsPort] = await Promise.all([
		start(PG, 5432, { Env: ["POSTGRES_PASSWORD=postgres"] }),
		start(NATS, 4222, { Cmd: ["-js"] }),
	]);
	const url = `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`;
	await retry(async () => {
		const probe = new SQL(url, { max: 1 });
		try {
			await probe`SELECT 1`;
		} finally {
			await probe.close().catch(() => {});
		}
	});
	await migrateDB(url);
	sql = new SQL(url);
	const db = drizzle({ client: sql });
	// the consumer writes through the app's db handle; point it at this container
	mock.module("../../../db", () => ({ db }));
	await retry(async () => {
		await closeNats().catch(() => {});
		await connectNats({ servers: `nats://127.0.0.1:${natsPort}` });
	}, 60);
	recordings = await import("../consumer");
	stream = await import("../stream");

	await sql`INSERT INTO projects (id, name, slug) VALUES ('p1', 'Shop', 'shop'), ('p2', 'Other', 'other')`;
	await sql`INSERT INTO routes (id, project_id, record_execution) VALUES ('r-on', 'p1', true), ('r-off', 'p1', false), ('r-flip', 'p1', true)`;
	await sql`INSERT INTO workflows (id, project_id, record_execution) VALUES ('w-on', 'p1', true)`;
	consumers.push(...(await recordings.startRecordingConsumer()));
}, 180_000);

afterAll(async () => {
	await Promise.allSettled(consumers.map((c) => c.stop()));
	await closeNats().catch(() => {});
	await sql?.close().catch(() => {});
	await Promise.allSettled(containers.map((c) => c.remove({ force: true })));
});

async function until(done: () => Promise<boolean>, ms = 10_000) {
	const deadline = Date.now() + ms;
	while (!(await done())) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await Bun.sleep(50);
	}
}

const wallStart = Date.parse("2026-10-01T10:00:00.000Z");

function makeRun(overrides: Partial<TraceRunPayload> = {}): TraceRunPayload {
	return {
		runId: crypto.randomUUID(),
		projectId: "p1",
		routeId: "r-on",
		routeVersion: "2026-10-01T09:00:00.000Z",
		method: "POST",
		path: "/orders",
		startedAtWallMs: wallStart,
		perfOrigin: 5_000,
		endedAt: 5_250,
		outcome: "success",
		statusCode: 200,
		spans: [
			{
				seq: 0,
				blockId: "entry",
				blockType: "entrypoint",
				startedAt: 5_000,
				endedAt: 5_010,
				outcome: "success",
				input: { order: { id: 7 } },
				output: "plain text",
			},
			{
				seq: 1,
				parentSeq: 0,
				blockId: "rd-double",
				blockType: "jsrunner",
				customBlockId: "cb-1",
				startedAt: 5_100,
				endedAt: 5_200,
				outcome: "failure",
				error: "Error: boom",
			},
		],
		...overrides,
	};
}

const runRow = async (id: string) => (await sql`SELECT * FROM trace_runs WHERE id = ${id}`)[0];
const spanRows = (id: string) =>
	sql`SELECT *, input->'order'->>'id' AS order_id FROM trace_spans WHERE run_id = ${id} ORDER BY seq`;

describe("recordings consumer", () => {
	it("stores a published run and its spans on the wall clock", async () => {
		const run = makeRun();
		await stream.publishRecording(run);
		await until(async () => Boolean(await runRow(run.runId)));

		const row = await runRow(run.runId);
		expect(row.project_id).toBe("p1");
		expect(row.route_id).toBe("r-on");
		expect(row.workflow_id).toBeNull();
		expect(row.started_at.toISOString()).toBe("2026-10-01T10:00:00.000Z");
		expect(row.ended_at.toISOString()).toBe("2026-10-01T10:00:00.250Z");
		expect(row.span_count).toBe(2);
		expect(row.status_code).toBe(200);

		const spans = await spanRows(run.runId);
		expect(spans).toHaveLength(2);
		// stored as real JSON objects, not strings: SQL can reach inside them
		expect(spans[0].order_id).toBe("7");
		expect(spans[0].output).toBe("plain text");
		expect(spans[1].started_at.toISOString()).toBe("2026-10-01T10:00:00.100Z");
		expect(spans[1].custom_block_id).toBe("cb-1");
		expect(spans[1].parent_seq).toBe(0);
		expect(spans[1].error).toBe("Error: boom");
		expect(spans[1].outcome).toBe("failure");
	});

	it("stores a route that answered with a string status as a number (#625)", async () => {
		const route = { projectId: "p1", routeId: "r-on", routeVersion: "v1", method: "GET", path: "/x" };
		let runId = "";
		const recorder = new RouteTraceRecorder(route, (run) => {
			runId = run.runId;
			void stream.publishRecording(run);
		});
		// a response block configured with httpCode "200" hands the string through
		traceCompleter(recorder)("success", "200" as unknown as number);
		await until(async () => Boolean(runId && (await runRow(runId))));

		expect((await runRow(runId)).status_code).toBe(200);
	});

	it("stores a workflow run", async () => {
		const run = makeRun({ routeId: undefined, workflowId: "w-on", workflowVersion: "v1" });
		expect(await recordings.persistRecording(run)).toBe("stored");
		expect((await runRow(run.runId)).workflow_id).toBe("w-on");
	});

	it("writes a redelivered run once", async () => {
		const run = makeRun();
		await recordings.persistRecording(run);
		await recordings.persistRecording(run);

		expect(await sql`SELECT id FROM trace_runs WHERE id = ${run.runId}`).toHaveLength(1);
		expect(await spanRows(run.runId)).toHaveLength(2);
	});

	it("drops a run whose recording was switched off, or that names another project", async () => {
		const run = makeRun({ routeId: "r-flip" });
		await sql`UPDATE routes SET record_execution = false WHERE id = 'r-flip'`;

		expect(await recordings.persistRecording(run)).toBe("dropped");
		expect(await recordings.persistRecording(makeRun({ routeId: "r-off" }))).toBe("dropped");
		expect(await recordings.persistRecording(makeRun({ projectId: "p2" }))).toBe("dropped");
		expect(await runRow(run.runId)).toBeUndefined();
	});

	describe("test run traces (#627)", () => {
		const metadata = (testRunId: string, caseIndex = 0) => ({
			source: "test" as const,
			label: "Test: Checkout · Request",
			testRunId,
			suiteId: "suite-1",
			suiteName: "Checkout",
			caseIndex,
			caseName: "Request",
		});
		const listRuns = async (query: { source?: "test" | "live"; testRunId?: string } = {}) => {
			const { getRecordedRuns } = await import("../../../api/v1/recordings/get-runs/repository");
			const { result } = await getRecordedRuns("p1", { type: "route", id: "r-off" }, query, 0, 50);
			return result.map((run) => run.id);
		};

		it("stores a test run even with recording off, metadata included", async () => {
			const run = makeRun({ routeId: "r-off", metadata: metadata("tr-1") });
			run.spans[1]!.metadata = { mocked: { output: true } };
			await stream.publishRecording(run);
			await until(async () => Boolean(await runRow(run.runId)));

			expect((await runRow(run.runId)).metadata).toEqual(metadata("tr-1"));
			const spans = await spanRows(run.runId);
			expect(spans).toHaveLength(2);
			// a mocked span says so; the rest leave metadata null
			expect(spans.map((span: { metadata: unknown }) => span.metadata)).toEqual([
				null,
				{ mocked: { output: true } },
			]);
		});

		it("keeps a span's position and switch pick next to its mock (#628)", async () => {
			const run = makeRun({ routeId: "r-off", metadata: metadata("tr-pos") });
			run.spans[0]!.metadata = { position: { x: 12.5, y: -40 } };
			run.spans[1]!.metadata = { mocked: { input: true }, position: { x: 0, y: 0 }, next: "b1" };
			await stream.publishRecording(run);
			await until(async () => Boolean(await runRow(run.runId)));

			const spans = await spanRows(run.runId);
			expect(spans.map((span: { metadata: unknown }) => span.metadata)).toEqual([
				{ position: { x: 12.5, y: -40 } },
				{ mocked: { input: true }, position: { x: 0, y: 0 }, next: "b1" },
			]);
		});

		it("still drops a test run that names another project", async () => {
			const run = makeRun({ projectId: "p2", routeId: "r-off", metadata: metadata("tr-2") });
			expect(await recordings.persistRecording(run)).toBe("dropped");
			expect(await runRow(run.runId)).toBeUndefined();
		});

		it("the run list shows test traces by default and filters by source", async () => {
			const normal = makeRun({ routeId: "r-off" });
			const test = makeRun({ routeId: "r-off", metadata: metadata("tr-3") });
			const other = makeRun({ routeId: "r-off", metadata: metadata("tr-4") });
			// stored directly: a normal run of a route with recording off is dropped
			await sql`INSERT INTO trace_runs (id, project_id, route_id, started_at, outcome, span_count)
				VALUES (${normal.runId}, 'p1', 'r-off', now(), 'success', 0)`;
			await recordings.persistRecording(test);
			await recordings.persistRecording(other);

			const all = await listRuns();
			expect(all).toEqual(expect.arrayContaining([normal.runId, test.runId, other.runId]));
			const tests = await listRuns({ source: "test" });
			expect(tests).toEqual(expect.arrayContaining([test.runId, other.runId]));
			expect(tests).not.toContain(normal.runId);
			const live = await listRuns({ source: "live" });
			expect(live).toContain(normal.runId);
			expect(live).not.toContain(test.runId);
			expect(await listRuns({ testRunId: "tr-3" })).toEqual([test.runId]);
		});

		it("a test run's results name each case's trace", async () => {
			const { getTestRunById } = await import(
				"../../../api/v1/test-suites/get-run-by-id/repository"
			);
			await sql`INSERT INTO test_runs (id, project_id, workflow_id, total_suites) VALUES ('tr-5', 'p1', 'w-on', 1)`;
			await sql`INSERT INTO test_suite_runs (id, test_run_id, project_id, workflow_id, test_suite_id)
				VALUES ('sr-5', 'tr-5', 'p1', 'w-on', 'suite-1')`;
			const workflowRun = (caseIndex: number) =>
				makeRun({ routeId: undefined, workflowId: "w-on", metadata: metadata("tr-5", caseIndex) });
			const [first, second] = [workflowRun(0), workflowRun(1)];
			// an async run a case forked hangs off the case's own trace
			const forked = makeRun({
				routeId: undefined,
				workflowId: "w-on",
				parentRunId: first.runId,
				parentSeq: 1,
				metadata: metadata("tr-5", 0),
			});
			for (const run of [first, second, forked]) await recordings.persistRecording(run);

			const result = await getTestRunById("p1", { type: "workflow", id: "w-on" }, "tr-5");
			expect(result?.traceExpired).toBe(false);
			const traces = result?.suiteRuns[0]?.traces ?? [];
			expect(traces.toSorted((a, b) => a.caseIndex - b.caseIndex)).toEqual([
				{ caseIndex: 0, traceRunId: first.runId },
				{ caseIndex: 1, traceRunId: second.runId },
			]);
		});
	});

	it("acks and drops a malformed payload", async () => {
		expect(await recordings.persistRecording({ hello: "world" })).toBe("dropped");
		expect(await recordings.persistRecording(makeRun({ runId: "not-a-uuid" }))).toBe("dropped");
		expect(
			await recordings.persistRecording({ ...makeRun(), workflowId: "w-on" }),
		).toBe("dropped");

		const before = (await sql`SELECT count(*)::int AS n FROM trace_runs`)[0].n;
		await publishToStream(natsConnection(), stream.RECORDINGS_SUBJECT, { hello: "world" });
		// acked, not redelivered: an acked message leaves a work-queue stream
		await until(async () => {
			const reply = await natsConnection().request(`$JS.API.STREAM.INFO.${stream.RECORDINGS_STREAM}`);
			return reply.json<{ state: { messages: number } }>().state.messages === 0;
		});
		expect((await sql`SELECT count(*)::int AS n FROM trace_runs`)[0].n).toBe(before);
	});

	it("retention deletes only runs past the age limit, spans with them", async () => {
		const day = 24 * 60 * 60_000;
		const fresh = makeRun({ startedAtWallMs: Date.now() - 2 * day });
		const old = makeRun({ startedAtWallMs: Date.now() - 40 * day });
		await recordings.persistRecording(fresh);
		await recordings.persistRecording(old);
		// more than one batch of old runs
		await sql`
			INSERT INTO trace_runs (id, project_id, route_id, started_at, outcome, span_count)
			SELECT gen_random_uuid(), 'p1', 'r-on', now() - interval '31 days', 'success', 0
			FROM generate_series(1, 250)`;

		const deleted = await recordings.deleteExpiredRecordings(30);

		expect(deleted).toBeGreaterThanOrEqual(251);
		expect(await runRow(old.runId)).toBeUndefined();
		expect(await spanRows(old.runId)).toHaveLength(0);
		expect(await runRow(fresh.runId)).toBeDefined();
		expect(await spanRows(fresh.runId)).toHaveLength(2);
		expect(
			(await sql`SELECT count(*)::int AS n FROM trace_runs WHERE started_at < now() - interval '30 days'`)[0]
				.n,
		).toBe(0);
	});

	// last: it takes NATS away
	it("drops and counts a run it cannot publish, without throwing", async () => {
		await Promise.allSettled(consumers.splice(0).map((c) => c.stop()));
		await closeNats();
		const before = stream.droppedRecordings();

		await stream.publishRecording(makeRun());

		expect(stream.droppedRecordings()).toBe(before + 1);
	});
});
