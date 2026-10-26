// Ephemeral runs (#741) against a real Postgres: a run is checked like a canvas
// save, leaves no row behind, and its one system log row is its owner's alone.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
	chain,
	newProject,
	newUser,
	ok,
	resetTestState,
	rowCounts,
	run,
	setupTestDb,
	short,
	state,
	teardownTestDb,
} from "./harness";

beforeAll(async () => setupTestDb(), 180_000);
afterAll(async () => teardownTestDb());
beforeEach(() => resetTestState());

describe("a successful run", () => {
	it("runs once, answers with the trace and leaves no row, key or recording", async () => {
		const project = await newProject();
		const user = await newUser();
		const before = await rowCounts();
		state.answers = [ok()];

		const res = await run(project, user, { ...chain, body: { a: 1 } });

		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ status: 200, body: { n: 1 } });
		expect(res.body.id).toStartWith("eph_");
		expect(res.body.debugTrace.spans[0]).toMatchObject({ blockId: "calc", outcome: "success" });
		expect(res.body.headers).not.toHaveProperty("x-fluxify-debug-trace");
		expect(JSON.stringify(res.body)).not.toContain("fxd_");

		expect(state.called).toHaveLength(1);
		expect(state.called[0]!.putBefore).toBe(true);
		expect(state.called[0]!.input).toMatchObject({ debug: true, body: { a: 1 }, method: "POST" });
		const key = `sandbox.${project}.${res.body.id}`;
		expect(state.writes.map((w) => [w.op, w.key, w.env])).toEqual([
			["put", key, "development"],
			["delete", key, "development"],
		]);
		const artifact = state.writes[0]!.value;
		expect(artifact).toMatchObject({
			sandbox: true,
			ephemeral: true,
			recordExecution: false,
			tracingEnabled: false,
		});
		expect(artifact.source).toContain("({ n: 1 })");
		expect(await rowCounts()).toEqual(before);
	});

	it("tries again only when the worker had not loaded it: a 404 with no trace", async () => {
		const project = await newProject();
		const user = await newUser();
		const notYet = () => ({ status: 404, contentType: null, body: { message: "Route not found" } });
		state.answers = [notYet, notYet, ok()];

		const res = await run(project, user, chain);

		expect(res.body.status).toBe(200);
		expect(state.called).toHaveLength(3);
		expect(state.called[0]!.input.method).toBe("GET");
		expect(state.writes.map((w) => w.op)).toEqual(["put", "delete"]);
	});

	it("also waits out a development token the worker has not learned yet: a 401 with no trace", async () => {
		const project = await newProject();
		const user = await newUser();
		const unknown = () => ({ status: 401, contentType: null, body: { message: "Missing or wrong development token" } });
		state.answers = [unknown, ok()];

		const res = await run(project, user, chain);

		expect(res.body.status).toBe(200);
		expect(state.called).toHaveLength(2);
	});

	it("does not try again on a 404 the graph itself answered", async () => {
		const project = await newProject();
		const user = await newUser();
		state.answers = [
			() => ({
				status: 404,
				contentType: "application/json",
				body: { message: "nope" },
				debugTrace: { spans: [{ blockId: "reply", blockType: "response", outcome: "success", ms: 1 }] },
			}),
		];

		const res = await run(project, user, chain);

		expect(res.body.status).toBe(404);
		expect(state.called).toHaveLength(1);
	});
});

describe("deleting the key", () => {
	it("happens when the call throws", async () => {
		const project = await newProject();
		const user = await newUser();
		state.answers = [
			() => {
				throw new Error("worker went away");
			},
		];

		const res = await run(project, user, chain);

		expect(res.status).toBe(500);
		expect(state.writes.map((w) => w.op)).toEqual(["put", "delete"]);
	});

	it("happens when the run times out", async () => {
		const project = await newProject();
		const user = await newUser();
		state.answers = [
			async () => {
				await Bun.sleep(1100);
				return { status: null, contentType: null, body: null, error: "Could not reach: aborted" };
			},
		];

		const res = await run(project, user, { ...chain, timeoutSeconds: 1 });

		expect(res.body.error).toContain("did not finish within 1 seconds");
		expect(state.called[0]!.abortAfterMs).toBeLessThanOrEqual(1000);
		expect(state.writes.map((w) => w.op)).toEqual(["put", "delete"]);
	});
});

describe("the timeout", () => {
	const timeoutOf = async (body: object, projectSetting = "") => {
		state.setting = projectSetting;
		const project = await newProject();
		const user = await newUser();
		state.answers = [ok()];
		state.writes.length = 0;
		await run(project, user, { ...chain, ...body });
		return state.writes.find((w) => w.op === "put")!.value.timeoutSeconds as number;
	};

	it("is the project's setting, and 10 when it has none", async () => {
		expect(await timeoutOf({}, "")).toBe(10);
		expect(await timeoutOf({}, "25")).toBe(25);
	});

	it("is the call's own, clamped to 1-30", async () => {
		expect(await timeoutOf({ timeoutSeconds: 3 }, "25")).toBe(3);
		expect(await timeoutOf({ timeoutSeconds: 0 })).toBe(1);
		expect(await timeoutOf({ timeoutSeconds: -5 })).toBe(1);
		expect(await timeoutOf({ timeoutSeconds: 120 })).toBe(30);
		expect(await timeoutOf({}, "99")).toBe(30);
	});
});

describe("a bad graph", () => {
	it("is a 400 that names the reason, and writes nothing", async () => {
		const project = await newProject();
		const user = await newUser();
		const before = await rowCounts();
		const refused = async (body: object) => {
			const res = await run(project, user, body);
			expect(res.status).toBe(400);
			return JSON.stringify(res.body);
		};

		expect(await refused({ blocks: [{ ref: "x", type: "not_a_block", data: {} }] })).toContain("Unknown block type");
		expect(await refused({ blocks: [{ ref: "e", type: "entrypoint" }] })).toContain("added for you");
		expect(await refused({ ...chain, edges: [{ from: "calc", to: "ghost" }] })).toContain('no block \\"ghost\\"');
		expect(
			await refused({
				blocks: [
					{ ref: "check", type: "if", data: {} },
					{ ref: "reply", type: "response", data: { httpCode: "200" } },
				],
				edges: [{ from: "check", to: "reply" }],
			}),
		).toContain("several handles");
		expect(
			await refused({
				blocks: [
					{ ref: "a", type: "jsrunner", data: { value: "return 1;" } },
					{ ref: "b", type: "jsrunner", data: { value: "return 2;" } },
				],
				edges: [
					{ from: "a", to: "b" },
					{ from: "b", to: "a" },
				],
			}),
		).toContain("Nothing to start from");
		expect(await refused({ blocks: [chain.blocks[0], { ...chain.blocks[0] }], edges: [] })).toContain("share a ref");

		expect(state.called).toHaveLength(0);
		expect(state.writes).toHaveLength(0);
		expect(await rowCounts()).toEqual(before);
	});

	it("is refused by the same block data rules as a save", async () => {
		const project = await newProject();
		const user = await newUser();
		const res = await run(project, user, {
			blocks: [{ ref: "calc", type: "jsrunner", data: { value: 12 } }],
		});
		expect(res.status).toBe(400);
		expect(state.writes).toHaveLength(0);
	});
});

describe("who may run", () => {
	it("refuses a viewer", async () => {
		const project = await newProject();
		const user = await newUser();
		expect((await run(project, user, chain, "viewer")).status).toBe(403);
	});

	it("says how to start a worker when none is running, before compiling anything", async () => {
		const project = await newProject();
		const user = await newUser();
		state.devWorker = false;
		const res = await run(project, user, chain);
		expect(res.status).toBe(409);
		expect(JSON.stringify(res.body)).toContain("FLUXIFY_ENV=development");
		expect(state.writes).toHaveLength(0);
	});
});

describe("the system log row", () => {
	it("is one per run, success or failure, with the output or the error and stack", async () => {
		const project = await newProject();
		const user = await newUser();
		state.answers = [
			ok({ n: 7 }),
			() => ({
				status: 500,
				contentType: "application/json",
				body: { message: "Internal server error" },
				debugError: {
					block: { id: "calc", type: "jsrunner", name: "Calc" },
					message: "boom",
					stack: "at calc (fluxify-graph:3:9)",
				},
				debugTrace: { spans: [{ blockId: "calc", blockType: "jsrunner", outcome: "failure", ms: 3, error: "boom" }] },
			}),
		];

		const good = await run(project, user, chain);
		const bad = await run(project, user, chain);

		const rows = await state.sql!`SELECT * FROM system_logs WHERE project_id = ${project} AND type = 'ephemeral' ORDER BY id`;
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			resource_type: "ephemeral",
			resource_id: good.body.id,
			level: "info",
			detail: { userId: user, env: "development", status: 200, output: { n: 7 } },
		});
		expect(rows[0]!.detail.blocks[0]).toMatchObject({ blockId: "calc", outcome: "success" });
		expect(typeof rows[0]!.detail.durationMs).toBe("number");
		expect(rows[1]).toMatchObject({
			resource_id: bad.body.id,
			level: "error",
			message: "boom",
			detail: { userId: user, status: 500, stack: "at calc (fluxify-graph:3:9)" },
		});
		expect(rows.every((r: { run_id: unknown }) => r.run_id === null)).toBe(true);
	});

	it("cuts a big output at 64 KB and says so", async () => {
		const project = await newProject();
		const user = await newUser();
		state.answers = [ok("x".repeat(100_000))];

		const res = await run(project, user, chain);

		const [row] = await state.sql!`SELECT detail FROM system_logs WHERE resource_id = ${res.body.id}`;
		expect(Buffer.byteLength(row!.detail.output)).toBe(64 * 1024);
		expect(row!.detail.note).toContain("cut at 64 KB");
	});

	it("is listed to the user who ran it and to nobody else", async () => {
		const { listSystemLogs } = await import("../../../../lib/systemLogs");
		const project = await newProject();
		const [mine, other] = [await newUser(), await newUser()];
		state.answers = [ok()];
		const res = await run(project, mine, chain);

		const seen = async (u: string) =>
			(await listSystemLogs({ projectId: project, type: "ephemeral" }, u)).map((r) => r.resourceId);
		expect(await seen(mine)).toEqual([res.body.id]);
		expect(await seen(other)).toEqual([]);
		expect(await seen("")).toEqual([]);
	});

	it("is deleted by the retention job once older than the recording max age", async () => {
		const { deleteExpiredRecordings } = await import("../../../../modules/recordings/consumer");
		const project = await newProject();
		const old = `eph_old${short()}`;
		const fresh = `eph_new${short()}`;
		const compile = `route${short()}`;
		await state.sql!`INSERT INTO system_logs (project_id, resource_type, resource_id, type, level, message, updated_at) VALUES
			(${project}, 'ephemeral', ${old}, 'ephemeral', 'info', 'old', now() - interval '40 days'),
			(${project}, 'ephemeral', ${fresh}, 'ephemeral', 'info', 'fresh', now()),
			(${project}, 'route', ${compile}, 'compile', 'info', 'old compile', now() - interval '40 days')`;

		await deleteExpiredRecordings(30);

		const left = (await state.sql!`SELECT resource_id FROM system_logs WHERE project_id = ${project}`).map((r: any) => r.resource_id);
		expect(left).toContain(fresh);
		expect(left).not.toContain(old);
		expect(left).toContain(compile);
	});
});

describe("at the persistent sandbox cap", () => {
	afterEach(() => delete process.env.MAX_SANDBOX_PER_USER);

	it("still runs once, because it saves no sandbox (#763)", async () => {
		process.env.MAX_SANDBOX_PER_USER = "1";
		const project = await newProject();
		const user = await newUser();
		const before = await rowCounts();
		state.answers = [ok()];

		const res = await run(project, user, chain);

		expect(res.status).toBe(200);
		expect(res.body.status).toBe(200);
		expect((await rowCounts()).sandboxes).toBe(before.sandboxes);
	});
});
