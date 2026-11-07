import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { errorHandler } from "@fluxify/server";
import { Hono } from "hono";
import * as reviews from "../../../agent/review/repository";
import * as integration from "../../../agent/runner/integration";
import * as queue from "../../../agent/runner/queue";
import * as quota from "./rateLimit";
import { registerAgentRoutes } from "./register";

// spyOn, not mock.module: module mocks leak into every other spec in the run.
const row = (over: object = {}) =>
	({
		id: "rev1",
		projectId: "p1",
		kind: "route",
		targetId: "r1",
		userId: "u1",
		status: "completed",
		canvasRevision: 5,
		summary: "ok",
		findings: [],
		error: null,
		usage: null,
		createdAt: new Date(),
		completedAt: new Date(),
		updatedAt: new Date(),
		...over,
	}) as reviews.Review;

let current: reviews.Review | undefined;
let held = false;
let hasModel = true;
const spies = {
	revision: spyOn(reviews, "targetRevision").mockImplementation(async (kind, id, projectId) =>
		kind === "route" && id === "r1" && projectId === "p1" ? 5 : undefined,
	),
	get: spyOn(reviews, "getReview").mockImplementation(async () => current),
	start: spyOn(reviews, "startReview").mockImplementation(async () => {
		current = row({ id: "rev2", status: "running", canvasRevision: null, summary: null });
		return current;
	}),
	end: spyOn(reviews, "endReview").mockImplementation(async (_id, status) => {
		if (current) current = { ...current, status };
		return true;
	}),
	publish: spyOn(queue, "publishAgentJob").mockResolvedValue(),
	stop: spyOn(queue, "requestStop").mockResolvedValue(undefined as never),
	held: spyOn(queue, "isHeld").mockImplementation(async () => held),
	quota: spyOn(quota, "assertRunQuota").mockResolvedValue(),
	model: spyOn(integration, "hasAgentConnection").mockImplementation(async () => hasModel),
};
afterAll(() => {
	for (const s of Object.values(spies)) s.mockRestore();
});

let role: string | undefined;
const app = new Hono();
app.onError(errorHandler);
app.use("*", async (c, next) => {
	c.set("user" as never, { id: "u1", isSystemAdmin: false } as never);
	c.set("acl" as never, (role ? [{ projectId: "p1", role }] : []) as never);
	await next();
});
registerAgentRoutes(app as never);

const R = "/agent/p1/reviews/route/r1";
const call = (method: string, path = R) => app.request(path, { method });
const read = async (res: Response | Promise<Response>) => (await (await res).json()) as any;

beforeEach(() => {
	role = "creator";
	current = undefined;
	held = false;
	hasModel = true;
	for (const s of Object.values(spies)) s.mockClear();
});

describe("AI canvas review API", () => {
	it("anyone in the project reads the report; only creators start or stop one", async () => {
		role = "viewer";
		current = row();
		expect((await call("GET")).status).toBe(200);
		expect((await call("POST")).status).toBe(403);
		expect((await call("POST", `${R}/stop`)).status).toBe(403);
		role = undefined;
		expect((await call("GET")).status).toBe(403);
	});

	it("is a 404 for a target outside the project or an unknown kind", async () => {
		expect((await call("GET", "/agent/p1/reviews/route/elsewhere")).status).toBe(404);
		expect((await call("POST", "/agent/p1/reviews/sandbox/r1")).status).toBe(404);
	});

	it("reads null before the first review", async () => {
		expect(await read(call("GET"))).toBeNull();
	});

	it("starts a review job for the target", async () => {
		const res = await call("POST");
		expect(res.status).toBe(202);
		expect((await read(res)).status).toBe("running");
		expect(spies.quota).toHaveBeenCalledWith("u1");
		expect(spies.publish).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "review",
				runId: "rev2",
				conversationId: "rev2",
				userId: "u1",
				projectId: "p1",
				review: { kind: "route", targetId: "r1" },
			}),
		);
	});

	it("a second click while one runs starts nothing", async () => {
		current = row({ status: "running" });
		held = true;
		const res = await call("POST");
		expect(res.status).toBe(200);
		expect(spies.start).not.toHaveBeenCalled();
		expect(spies.publish).not.toHaveBeenCalled();
	});

	it("refuses to start without an AI connection", async () => {
		hasModel = false;
		const res = await call("POST");
		expect(res.status).toBe(400);
		expect(spies.publish).not.toHaveBeenCalled();
	});

	it("marks a report stale once the canvas moved past the revision it read", async () => {
		current = row({ canvasRevision: 4 });
		expect((await read(call("GET"))).stale).toBe(true);
		current = row({ canvasRevision: 5 });
		expect((await read(call("GET"))).stale).toBe(false);
		// a running review has read nothing yet
		current = row({ status: "running", canvasRevision: null });
		expect((await read(call("GET"))).stale).toBe(false);
	});

	it("stop asks the worker that holds it, or cancels one nobody holds", async () => {
		current = row({ status: "running" });
		held = true;
		await call("POST", `${R}/stop`);
		expect(spies.stop).toHaveBeenCalledWith("rev1");
		expect(spies.end).not.toHaveBeenCalled();

		held = false;
		const res = await call("POST", `${R}/stop`);
		expect(spies.end).toHaveBeenCalledWith("rev1", "cancelled");
		expect((await read(res)).status).toBe("cancelled");
	});

	it("a running review whose worker died is shown failed, and can be run again", async () => {
		current = row({ status: "running", updatedAt: new Date(Date.now() - 10 * 60_000) });
		expect((await read(call("GET"))).status).toBe("failed");
		expect(spies.end).toHaveBeenCalledWith("rev1", "failed", expect.stringContaining("restarted"));

		current = row({ status: "running", updatedAt: new Date(Date.now() - 10 * 60_000) });
		expect((await call("POST")).status).toBe(202);
	});
});
