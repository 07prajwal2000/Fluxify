import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
	routesEntity,
	testRunsEntity,
	testSuiteRunsEntity,
	testSuitesEntity,
} from "../../../db/schema";
import {
	dbIntegrationsCache,
	OWNER_KEY,
} from "../../../loaders/integrationsLoader";
import type { Pool } from "../pool";
import type { TestResult } from "../types";

const PROJECT = "p1";
const ROUTE = "r1";

/**
 * A fake drizzle: it answers by TABLE and ignores the where-clause, which is
 * enough to prove the orchestration — the ordering of writes, how many times
 * the compile runs, and what each row ends up as. What it deliberately cannot
 * prove is the SQL itself.
 */
const state = {
	routes: [{ id: ROUTE, projectId: PROJECT }] as any[],
	suites: [] as any[],
	/** every UPDATE in the order it was issued */
	updates: [] as Array<{ table: string; values: any }>,
};

const label = (table: unknown) =>
	table === testRunsEntity
		? "run"
		: table === testSuiteRunsEntity
			? "suiteRun"
			: "other";

mock.module("../../../db", () => ({
	db: {
		select: () => ({
			from: (table: unknown) => ({
				where: async () =>
					table === routesEntity
						? state.routes
						: table === testSuitesEntity
							? state.suites
							: [],
			}),
		}),
		insert: (table: unknown) => ({
			values: (values: any) => ({
				returning: async () =>
					table === testRunsEntity
						? [{ id: "run-1" }]
						: (values as any[]).map((row, i) => ({
								id: `sr-${i}`,
								testSuiteId: row.testSuiteId,
							})),
			}),
		}),
		update: (table: unknown) => ({
			set: (values: any) => ({
				where: async () => {
					state.updates.push({ table: label(table), values });
				},
			}),
		}),
	},
}));

const { startTestRun, TestRunError } = await import("../runner");

function suite(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		name: `suite ${id}`,
		routeId: ROUTE,
		headers: {},
		params: {},
		queryParams: {},
		routeParams: {},
		body: null,
		assertions: [{ target: "status", operator: "eq", expectedValue: "200" }],
		integrationOverrides: [],
		appConfigOverrides: [],
		...overrides,
	};
}

const compiled = {
	route: {
		id: ROUTE,
		method: "GET",
		path: "/demo",
		projectId: PROJECT,
		projectName: "demo",
		bodySchema: null,
		querySchema: null,
		paramsSchema: null,
		timeoutSeconds: 30,
	},
	source: "compiled",
	customBlocks: [],
};

/** unlimited concurrency — the pool has its own spec */
const openPool: Pool = {
	run: (task) => task(),
	active: 0,
	queued: 0,
	limit: 99,
};

function deps(spawn: (b: any) => Promise<TestResult>) {
	const compile = mock(async () => compiled as any);
	return {
		compile,
		resolve: mock(async () => ({}) as any),
		spawn: mock(spawn),
		pool: openPool,
	};
}

const ok = (status: number): TestResult => ({
	ok: true,
	status,
	data: { hello: "world" },
	headers: { "x-suite": "ok" },
	durationMs: 5,
});

beforeEach(() => {
	state.suites = [];
	state.updates = [];
	for (const key of Object.keys(dbIntegrationsCache)) {
		delete dbIntegrationsCache[key];
	}
});

describe("startTestRun", () => {
	it("runs the whole fleet and settles the parent on the suites' verdicts", async () => {
		state.suites = [suite("s1"), suite("s2")];
		const d = deps(async (b) => ok(b.request.path === "/demo" ? 200 : 500));

		const { runId, done } = await startTestRun(
			{ projectId: PROJECT, routeId: ROUTE },
			d,
		);
		await done;

		expect(runId).toBe("run-1");
		expect(d.spawn).toHaveBeenCalledTimes(2);

		const suiteRuns = state.updates.filter((u) => u.table === "suiteRun");
		// running first, then the terminal write — the UI polls between the two
		expect(suiteRuns.map((u) => u.values.status)).toEqual([
			"running",
			"running",
			"passed",
			"passed",
		]);
		// the response headers actually reach the assertion context
		expect(suiteRuns.at(-1)!.values.result.headers).toEqual({ "x-suite": "ok" });

		const parent = state.updates.filter((u) => u.table === "run");
		expect(parent[0]!.values.status).toBe("running");
		expect(parent.at(-1)!.values).toMatchObject({
			status: "passed",
			passedCount: 2,
			failedCount: 0,
			result: { total: 2, passed: 2, failed: 0, suites: { s1: "passed", s2: "passed" } },
		});
	});

	it("fails the run when one suite's assertions fail", async () => {
		state.suites = [suite("s1"), suite("s2")];
		let first = true;
		const d = deps(async () => {
			const status = first ? 200 : 500;
			first = false;
			return ok(status);
		});

		await (await startTestRun({ projectId: PROJECT, routeId: ROUTE }, d)).done;

		const parent = state.updates.filter((u) => u.table === "run").at(-1)!;
		expect(parent.values).toMatchObject({
			status: "failed",
			passedCount: 1,
			failedCount: 1,
		});
	});

	it("compiles exactly once no matter how many suites run", async () => {
		state.suites = [suite("s1"), suite("s2"), suite("s3")];
		const d = deps(async () => ok(200));

		await (await startTestRun({ projectId: PROJECT, routeId: ROUTE }, d)).done;

		// per-suite compilation would be the same work three times — and could
		// hand two suites of one run different code if the route were edited
		expect(d.compile).toHaveBeenCalledTimes(1);
		expect(d.resolve).toHaveBeenCalledTimes(3);
	});

	it("records a hung suite as a timeout and still settles the run", async () => {
		state.suites = [suite("s1"), suite("s2")];
		let first = true;
		const d = deps(async () => {
			if (first) {
				first = false;
				return { ok: false, timedOut: true, error: "suite timed out", durationMs: 32_000 };
			}
			return ok(200);
		});

		await (await startTestRun({ projectId: PROJECT, routeId: ROUTE }, d)).done;

		const timedOut = state.updates.find(
			(u) => u.table === "suiteRun" && u.values.status === "timeout",
		)!;
		expect(timedOut.values.durationMs).toBe(32_000);
		// a killed process has no partial verdicts
		expect(timedOut.values.result).toEqual({
			success: false,
			result: [],
			error: "suite timed out",
		});

		const parent = state.updates.filter((u) => u.table === "run").at(-1)!;
		expect(parent.values.status).toBe("failed");
		expect(parent.values.finishedAt).toBeInstanceOf(Date);
	});

	it("marks the run and its suites `error` when the compile throws", async () => {
		state.suites = [suite("s1")];
		const d = deps(async () => ok(200));
		d.compile = mock(async () => {
			throw new Error("graph is not connected");
		});

		await (await startTestRun({ projectId: PROJECT, routeId: ROUTE }, d)).done;

		expect(d.spawn).not.toHaveBeenCalled();
		const parent = state.updates.filter((u) => u.table === "run").at(-1)!;
		expect(parent.values.status).toBe("error");
		expect(parent.values.result.error).toContain("graph is not connected");
		// a row left on `running` makes the UI poll forever
		expect(
			state.updates.filter((u) => u.table === "suiteRun").at(-1)!.values.status,
		).toBe("error");
	});

	it("rejects a foreign integration override before anything is spawned", async () => {
		dbIntegrationsCache.foreign = { [OWNER_KEY]: "other-project" };
		state.suites = [
			suite("s1", {
				integrationOverrides: [{ existingId: "mine", newId: "foreign" }],
			}),
		];
		const d = deps(async () => ok(200));

		// an ownership check performed inside the sandbox would be worthless
		await expect(
			startTestRun({ projectId: PROJECT, routeId: ROUTE }, d),
		).rejects.toThrow(TestRunError);
		expect(d.spawn).not.toHaveBeenCalled();
		expect(state.updates).toEqual([]);
	});

	it("404s an unknown route and 403s another project's", async () => {
		const d = deps(async () => ok(200));
		state.routes = [];
		await expect(
			startTestRun({ projectId: PROJECT, routeId: ROUTE }, d),
		).rejects.toMatchObject({ status: 404 });

		state.routes = [{ id: ROUTE, projectId: "someone-else" }];
		await expect(
			startTestRun({ projectId: PROJECT, routeId: ROUTE }, d),
		).rejects.toMatchObject({ status: 403 });

		state.routes = [{ id: ROUTE, projectId: PROJECT }];
	});

	it("404s a route that has no suites", async () => {
		const d = deps(async () => ok(200));
		await expect(
			startTestRun({ projectId: PROJECT, routeId: ROUTE }, d),
		).rejects.toMatchObject({ status: 404 });
	});
});
