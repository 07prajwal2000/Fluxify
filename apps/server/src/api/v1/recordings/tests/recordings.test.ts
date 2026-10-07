// Recording endpoints (#255) against a real Postgres: the filters, the ordering,
// the scoping and the cascade are the database's job, so a fake db proves nothing.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { Hono } from "hono";
import { migrateDB } from "../../../../db/migration";
import { errorHandler } from "../../../../middlewares/errorHandler";

const PG = { image: "postgres:16-alpine", name: "fluxify-recording-endpoints-pg-test" };
let container: Docker.Container | undefined;
let sql: SQL;
let app: Hono<any>;

beforeAll(async () => {
	await docker.getContainer(PG.name).remove({ force: true }).catch(() => {});
	await pullImage(PG.image);
	const started = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: PG.image,
			name: PG.name,
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
	const db = drizzle({ client: sql });
	mock.module("../../../../db", () => ({ db }));

	const register = (await import("../register")).default;
	app = new Hono<any>();
	app.onError(errorHandler);
	// the real `requireProjectAccess`, fed the role the test asks for
	app.use(async (ctx, next) => {
		ctx.set("user", { id: "u1", isSystemAdmin: false });
		ctx.set("acl", [{ projectId: "p1", role: ctx.req.header("X-Role") ?? "creator" }, { projectId: "p2", role: "creator" }]);
		await next();
	});
	register.registerHandler(app);

	await sql`INSERT INTO projects (id, name, slug) VALUES ('p1', 'Shop', 'shop'), ('p2', 'Other', 'other')`;
	await sql`INSERT INTO routes (id, project_id) VALUES ('r1', 'p1'), ('r2', 'p1')`;
	await sql`INSERT INTO workflows (id, project_id) VALUES ('w1', 'p1')`;
}, 180_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

const base = Date.parse("2026-10-01T10:00:00.000Z");
const at = (minutes: number) => new Date(base + minutes * 60_000);

type Run = {
	route?: string;
	workflow?: string;
	minute: number;
	outcome?: "success" | "failure";
	open?: boolean;
	parent?: { id: string; seq: number };
};

async function insertRun({ route, workflow, minute, outcome = "success", open, parent }: Run) {
	const id = crypto.randomUUID();
	const started = at(minute);
	const ended = open ? null : new Date(started.getTime() + 250);
	await sql`
		INSERT INTO trace_runs (id, project_id, route_id, workflow_id, started_at, ended_at, outcome, status_code, span_count, truncated, dropped_spans, parent_run_id, parent_seq)
		VALUES (${id}, 'p1', ${route ?? null}, ${workflow ?? null}, ${started}, ${ended}, ${outcome}, ${route ? 200 : null}, 0, ${Boolean(open)}, ${open ? 3 : 0}, ${parent?.id ?? null}, ${parent?.seq ?? null})`;
	return id;
}

async function insertSpan(runId: string, seq: number, extra: { parentSeq?: number; customBlockId?: string } = {}) {
	const started = at(seq);
	await sql`
		INSERT INTO trace_spans (run_id, seq, parent_seq, block_id, block_type, custom_block_id, started_at, ended_at, outcome, input, output, truncated)
		VALUES (${runId}, ${seq}, ${extra.parentSeq ?? null}, ${`b${seq}`}, 'jsrunner', ${extra.customBlockId ?? null}, ${started}, ${started}, 'success', ${JSON.stringify({ n: seq })}::text::jsonb, ${seq}::text::jsonb, ${seq === 2})`;
}

const runsUrl = (kind: string, target: string, project = "p1") =>
	`http://localhost/${project}/recordings/${kind}/${target}/runs`;
const get = async (url: string, role?: string) => {
	const res = await app.request(url, { headers: role ? { "X-Role": role } : {} });
	return { status: res.status, body: (await res.json()) as any };
};
const del = async (url: string) => {
	const res = await app.request(url, { method: "DELETE" });
	return { status: res.status, body: (await res.json()) as any };
};

beforeEach(async () => {
	await sql`DELETE FROM trace_runs`;
});

describe("access", () => {
	it("refuses a viewer on every endpoint, reads included", async () => {
		const id = await insertRun({ route: "r1", minute: 0 });
		for (const url of [runsUrl("route", "r1"), `${runsUrl("route", "r1")}/${id}`]) {
			expect((await get(url, "viewer")).status).toBe(403);
		}
		for (const url of [runsUrl("route", "r1"), `${runsUrl("route", "r1")}/${id}`]) {
			const res = await app.request(url, { method: "DELETE", headers: { "X-Role": "viewer" } });
			expect(res.status).toBe(403);
		}
		expect((await sql`SELECT id FROM trace_runs`).length).toBe(1);
	});
});

describe("GET runs", () => {
	it("pages newest first with run headers", async () => {
		for (let minute = 0; minute < 12; minute++) await insertRun({ route: "r1", minute });

		const first = await get(`${runsUrl("route", "r1")}?perPage=5`);
		expect(first.status).toBe(200);
		expect(first.body.pagination).toEqual({ page: 1, totalPages: 3, hasNext: true });
		expect(first.body.data.map((run: any) => run.startedAt)).toEqual(
			[11, 10, 9, 8, 7].map((m) => at(m).toISOString()),
		);
		expect(first.body.data[0]).toMatchObject({
			outcome: "success",
			statusCode: 200,
			durationMs: 250,
			spanCount: 0,
			truncated: false,
			droppedSpans: 0,
			parentRunId: null,
		});
		expect(first.body.data[0].spans).toBeUndefined();

		const last = await get(`${runsUrl("route", "r1")}?perPage=5&page=3`);
		expect(last.body.data).toHaveLength(2);
		expect(last.body.pagination).toEqual({ page: 3, totalPages: 3, hasNext: false });
	});

	it("filters by outcome and start time", async () => {
		await insertRun({ route: "r1", minute: 0 });
		const failed = await insertRun({ route: "r1", minute: 5, outcome: "failure", open: true });
		await insertRun({ route: "r1", minute: 10, outcome: "failure" });

		const failures = await get(`${runsUrl("route", "r1")}?outcome=failure`);
		expect(failures.body.data.map((run: any) => run.outcome)).toEqual(["failure", "failure"]);

		const window = await get(
			`${runsUrl("route", "r1")}?from=${at(5).toISOString()}&to=${at(10).toISOString()}`,
		);
		expect(window.body.data).toHaveLength(1);
		// an unfinished run has no duration; the stored flags come back as written
		expect(window.body.data[0]).toMatchObject({ id: failed, durationMs: null, truncated: true, droppedSpans: 3 });

		expect((await get(`${runsUrl("route", "r1")}?outcome=nope`)).status).toBe(400);
		expect((await get(`${runsUrl("route", "r1")}?from=not-a-date`)).status).toBe(400);
	});

	it("keeps routes and workflows apart", async () => {
		const routeRun = await insertRun({ route: "r1", minute: 0 });
		const workflowRun = await insertRun({ workflow: "w1", minute: 1 });

		expect((await get(runsUrl("route", "r1"))).body.data.map((r: any) => r.id)).toEqual([routeRun]);
		expect((await get(runsUrl("workflow", "w1"))).body.data.map((r: any) => r.id)).toEqual([workflowRun]);
		expect((await get(runsUrl("workflow", "r1"))).body.data).toEqual([]);
		expect((await get(runsUrl("route", "r1", "p2"))).body.data).toEqual([]);
		expect((await app.request(runsUrl("job", "r1"))).status).toBe(404);
	});
});

describe("GET runs/:runId", () => {
	it("returns the run, its spans in seq order and its async child runs", async () => {
		const id = await insertRun({ workflow: "w1", minute: 0 });
		for (const seq of [2, 0, 1]) {
			await insertSpan(id, seq, seq === 2 ? { parentSeq: 1, customBlockId: "cb-1" } : {});
		}
		const child = await insertRun({ workflow: "w1", minute: 1, parent: { id, seq: 1 } });

		const { status, body } = await get(`${runsUrl("workflow", "w1")}/${id}`);

		expect(status).toBe(200);
		expect(body).toMatchObject({ id, outcome: "success", durationMs: 250, parentRunId: null });
		expect(body.spans.map((span: any) => span.seq)).toEqual([0, 1, 2]);
		expect(body.spans[2]).toMatchObject({
			parentSeq: 1,
			customBlockId: "cb-1",
			input: { n: 2 },
			output: 2,
			truncated: true,
		});
		expect(body.spans[0]).toMatchObject({ parentSeq: null, customBlockId: null, truncated: false });
		expect(body.childRuns).toEqual([{ id: child, parentSeq: 1 }]);

		const childBody = (await get(`${runsUrl("workflow", "w1")}/${child}`)).body;
		expect(childBody).toMatchObject({ parentRunId: id, parentSeq: 1, childRuns: [], spans: [] });
	});

	it("404s a run outside the path's project or target", async () => {
		const id = await insertRun({ route: "r1", minute: 0 });

		expect((await get(`${runsUrl("route", "r1")}/${id}`)).status).toBe(200);
		expect((await get(`${runsUrl("route", "r1", "p2")}/${id}`)).status).toBe(404);
		expect((await get(`${runsUrl("route", "r2")}/${id}`)).status).toBe(404);
		expect((await get(`${runsUrl("workflow", "r1")}/${id}`)).status).toBe(404);
		expect((await get(`${runsUrl("route", "r1")}/${crypto.randomUUID()}`)).status).toBe(404);
		expect((await get(`${runsUrl("route", "r1")}/not-a-uuid`)).status).toBe(400);
	});
});

describe("DELETE runs", () => {
	it("deletes one run and its spans, only within the path's target", async () => {
		const id = await insertRun({ route: "r1", minute: 0 });
		const kept = await insertRun({ route: "r1", minute: 1 });
		await insertSpan(id, 0);

		expect((await del(`${runsUrl("route", "r2")}/${id}`)).body).toEqual({ deleted: 0 });
		expect((await del(`${runsUrl("route", "r1", "p2")}/${id}`)).body).toEqual({ deleted: 0 });
		expect((await del(`${runsUrl("route", "r1")}/${id}`)).body).toEqual({ deleted: 1 });

		expect((await sql`SELECT id FROM trace_runs`).map((r: any) => r.id)).toEqual([kept]);
		expect(await sql`SELECT seq FROM trace_spans WHERE run_id = ${id}`).toHaveLength(0);
	});

	it("deletes every run of one target and nothing else", async () => {
		const runs = [await insertRun({ route: "r1", minute: 0 }), await insertRun({ route: "r1", minute: 1 })];
		await insertSpan(runs[0]!, 0);
		const other = await insertRun({ route: "r2", minute: 2 });
		const workflow = await insertRun({ workflow: "w1", minute: 3 });

		expect((await del(runsUrl("route", "r1"))).body).toEqual({ deleted: 2 });

		const left = (await sql`SELECT id FROM trace_runs`).map((r: any) => r.id).sort();
		expect(left).toEqual([other, workflow].sort());
		expect(await sql`SELECT seq FROM trace_spans`).toHaveLength(0);
	});
});
