import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../../../../../middlewares/errorHandler";

const PROJECT = "proj-1";
const ROUTE = "route-1";

const state = {
	/** rows the fake drizzle hands back for the next select */
	rows: [] as any[],
	/** every where-clause the fake saw, so scoping can be asserted */
	selects: 0,
};

const started = mock(async (_input: any) => ({
	runId: "run-1",
	done: Promise.resolve(),
}));

class TestRunError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

mock.module("../../../../../modules/testRunner/runner", () => ({
	startTestRun: (input: any) => started(input),
	TestRunError,
}));

mock.module("../../../../../db", () => {
	const chain: any = {
		select: () => chain,
		from: () => chain,
		where: () => chain,
		orderBy: () => chain,
		offset: () => chain,
		limit: () => chain,
		then: (resolve: any) => {
			state.selects++;
			return Promise.resolve(state.rows).then(resolve);
		},
	};
	return { db: chain };
});

mock.module("../../../../auth/middleware", () => ({
	requireProjectAccess: (role: string) => async (ctx: any, next: any) => {
		if (ctx.req.header("X-Test-Role") === "viewer" && role === "creator") {
			return ctx.json({ type: "auth", message: "Access denied" }, 403);
		}
		return next();
	},
}));

const register = (await import("../../register")).default;

const app = new Hono<any>();
app.onError(errorHandler);
register.registerHandler(app);

const base = `http://localhost/${PROJECT}/test-suites/route/${ROUTE}/runs`;

beforeEach(() => {
	state.rows = [];
	state.selects = 0;
	started.mockClear();
});

describe("POST runs", () => {
	it("accepts a bodyless run and answers 202 with the id", async () => {
		const res = await app.request(new Request(base, { method: "POST" }));

		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({ runId: "run-1" });
		// project and route come from the path — no lookup happened to find them
		expect(started).toHaveBeenCalledWith({
			projectId: PROJECT,
			routeId: ROUTE,
			suiteIds: undefined,
		});
	});

	it("passes an explicit suite selection through", async () => {
		await app.request(
			new Request(base, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ suiteIds: ["s1", "s2"] }),
			}),
		);

		expect(started.mock.calls[0]![0].suiteIds).toEqual(["s1", "s2"]);
	});

	it("maps a runner rejection onto its own status", async () => {
		started.mockImplementationOnce(async () => {
			throw new TestRunError(403, "Route belongs to another project");
		});
		const res = await app.request(new Request(base, { method: "POST" }));
		expect(res.status).toBe(403);

		started.mockImplementationOnce(async () => {
			throw new TestRunError(404, "Route not found");
		});
		expect(
			(await app.request(new Request(base, { method: "POST" }))).status,
		).toBe(404);
	});

	it("refuses a viewer", async () => {
		const res = await app.request(
			new Request(base, { method: "POST", headers: { "X-Test-Role": "viewer" } }),
		);
		expect(res.status).toBe(403);
		expect(started).not.toHaveBeenCalled();
	});
});

describe("GET runs", () => {
	it("pages the history", async () => {
		state.rows = [{ id: "run-1" }];
		const res = await app.request(`${base}?page=1&perPage=5`);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data).toEqual([{ id: "run-1" }]);
		expect(body.pagination.page).toBe(1);
	});

	it("rejects an out-of-range page size before touching the database", async () => {
		const res = await app.request(`${base}?perPage=5000`);
		expect(res.status).toBe(400);
		expect(state.selects).toBe(0);
	});
});

describe("GET runs/:runId", () => {
	it("returns the run with its suite rows", async () => {
		state.rows = [{ id: "run-1", status: "passed" }];
		const res = await app.request(`${base}/run-1`);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.id).toBe("run-1");
		expect(body.suiteRuns).toEqual([{ id: "run-1", status: "passed" }]);
	});

	it("404s a run from another project rather than leaking that it exists", async () => {
		state.rows = [];
		const res = await app.request(`${base}/someone-elses-run`);
		expect(res.status).toBe(404);
	});
});
