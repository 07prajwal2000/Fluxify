import { describe, expect, it, mock } from "bun:test";
import type { AgentJob } from "../runner/queue";
import { executeReview, type ReviewDeps } from "./job";
import { toFindings, tooBig } from "./review";

const canvas = {
	canvasRevision: 7,
	blocks: [
		{ id: "b-entry", key: "entrypoint_1", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
		{
			id: "b-sql",
			key: "db_native_1",
			type: "db_native",
			data: { query: "js: return `select * from users where id = ${input.body.id}`" },
			position: { x: 1, y: 0 },
		},
		{ id: "b-auth", key: "check_auth_1", type: "check_auth", data: {}, position: { x: 2, y: 0 } },
	],
	edges: [{ id: "e1", from: "b-entry", to: "b-sql", fromHandle: "source", toHandle: "target" }],
};
const cbCanvas = { canvasRevision: 1, blocks: [], edges: [] };

/** The admin API this route and what it uses read from; anything else is a 404. */
const API: Record<string, unknown> = {
	"/v1/routes/r1": { id: "r1", name: "Users", method: "GET", path: "/users", bodySchema: null },
	"/v1/routes/r1/middlewares": { before: [{ id: "m1", name: "auth" }], after: [] },
	"/v1/routes/r1/canvas-items": canvas,
	"/v1/middlewares/m1": {
		id: "m1",
		name: "auth",
		blocks: [{ id: "cb-mw", name: "verify_token", label: "Verify token" }],
	},
	"/v1/middlewares/m1/references": { references: [] },
	"/v1/custom-blocks/list": [
		{ id: "cb1", name: "check_auth", label: "Check auth" },
		{ id: "cb-mw", name: "verify_token" },
		{ id: "cb-unused", name: "unused" },
	],
	"/v1/custom-blocks/cb1": { id: "cb1", name: "check_auth", inputParams: [] },
	"/v1/custom-blocks/cb1/references": { references: [] },
	"/v1/custom-blocks/cb1/canvas-items": cbCanvas,
	"/v1/custom-blocks/cb-mw": { id: "cb-mw", name: "verify_token" },
	"/v1/custom-blocks/cb-mw/references": { references: [] },
	"/v1/custom-blocks/cb-mw/canvas-items": cbCanvas,
	"/v1/test-suites/route/r1": [{ id: "s1", name: "happy path" }],
	"/v1/test-suites/s1": { id: "s1", name: "happy path", hooks: [], body: { id: 1 } },
	"/v1/p1/app-config/list": {
		data: [{ id: "a1", keyName: "DB_PASSWORD", value: "hunter2", devValue: "hunter3" }],
		pagination: { page: 1, hasNext: false },
	},
	"/v1/p1/integrations/list-basic": [
		{ id: "i1", name: "main db", group: "database", variant: "postgres", config: { password: "x" } },
	],
};

function fakeApi() {
	const paths: string[] = [];
	const headers: string[] = [];
	const fetcher = (url: string, init: RequestInit) => {
		const path = url.replace("/_/admin/api", "").split("?")[0]!;
		paths.push(path);
		headers.push((init.headers as Record<string, string>).authorization ?? "");
		return path in API
			? Response.json(API[path])
			: Response.json({ message: "nope" }, { status: 404 });
	};
	return { fetcher, paths, headers };
}

const job: AgentJob = {
	type: "review",
	conversationId: "rev1",
	runId: "rev1",
	userId: "u1",
	projectId: "p1",
	mode: "manual",
	review: { kind: "route", targetId: "r1" },
};

const report = {
	summary: "Reads a user by id.",
	findings: [
		{
			severity: "error" as const,
			category: "security" as const,
			message: "The body id goes straight into native SQL.",
			suggestedFix: "Use a parameter.",
			blockKeys: ["db_native_1", "db_native_1", "ghost_1"],
		},
	],
	usage: { inputTokens: 100, outputTokens: 20 },
};

function deps(over: Partial<ReviewDeps> = {}) {
	const api = fakeApi();
	const d = {
		fetcher: api.fetcher,
		model: mock(async () => ({}) as never),
		setting: mock(async () => undefined),
		token: mock(() => "agt_token"),
		run: mock(async () => report),
		touch: mock(async () => true),
		finish: mock(async () => true),
		end: mock(async () => true),
		...over,
	};
	return { d: d as ReviewDeps & typeof d, api };
}

describe("executeReview", () => {
	it("reads the route and what it uses, then saves findings tied to block ids", async () => {
		const { d, api } = deps();
		expect(await executeReview(job, new AbortController().signal, d)).toBe("completed");
		expect(d.finish).toHaveBeenCalledWith("rev1", {
			summary: report.summary,
			usage: report.usage,
			canvasRevision: 7,
			findings: [
				{
					severity: "error",
					category: "security",
					message: "The body id goes straight into native SQL.",
					suggestedFix: "Use a parameter.",
					blockKeys: ["db_native_1"],
					blockIds: ["b-sql"],
				},
			],
		});
		// the custom block on the canvas and the one in its middleware; not the unused one
		expect(api.paths).toContain("/v1/custom-blocks/cb1/canvas-items");
		expect(api.paths).toContain("/v1/custom-blocks/cb-mw/canvas-items");
		expect(api.paths).not.toContain("/v1/custom-blocks/cb-unused");
		expect(api.paths).toContain("/v1/test-suites/s1");
		// every read acts as the user who asked
		expect(new Set(api.headers)).toEqual(new Set(["Bearer agt_token"]));
		expect(d.token).toHaveBeenCalledWith("u1", "p1");
	});

	it("never reads or sends a secret value, only keys and names", async () => {
		const { d, api } = deps();
		await executeReview(job, new AbortController().signal, d);
		// no single app config or integration read: those return values
		expect(api.paths.some((p) => /app-config\/(?!list)|integrations\/(?!list)/.test(p))).toBe(false);
		const prompt = (d.run as unknown as ReturnType<typeof mock>).mock.calls[0]?.[2] as string;
		expect(prompt).toContain("DB_PASSWORD");
		expect(prompt).toContain("main db");
		expect(prompt).not.toContain("hunter");
		expect(prompt).not.toContain("password");
	});

	it("is skipped when the review was stopped or replaced before it started", async () => {
		const { d } = deps({ touch: mock(async () => false) });
		expect(await executeReview(job, new AbortController().signal, d)).toBe("skipped");
		expect(d.run).not.toHaveBeenCalled();
	});

	it("fails with a reason when the project has no AI connection", async () => {
		const { d } = deps({ model: mock(async () => undefined) });
		expect(await executeReview(job, new AbortController().signal, d)).toBe("failed");
		expect(d.end).toHaveBeenCalledWith("rev1", "failed", expect.stringContaining("no AI connection"));
	});

	it("fails with the model's error so the user can read it", async () => {
		const { d } = deps({
			run: mock(async () => {
				throw new Error("model is deactivated");
			}),
		});
		expect(await executeReview(job, new AbortController().signal, d)).toBe("failed");
		expect(d.end).toHaveBeenCalledWith("rev1", "failed", "model is deactivated");
	});

	it("fails before calling the model when the context is over the model's window", async () => {
		const { d } = deps({
			setting: mock(async (_p, key) => (key === "settings.ai.maxContextTokens" ? "100" : undefined)),
		});
		expect(await executeReview(job, new AbortController().signal, d)).toBe("failed");
		expect(d.run).not.toHaveBeenCalled();
		expect(d.end).toHaveBeenCalledWith("rev1", "failed", expect.stringContaining("tokens"));
	});

	it("is cancelled when stopped mid-run", async () => {
		const ctrl = new AbortController();
		const { d } = deps({
			run: mock(async () => {
				ctrl.abort(new Error("Stopped by user"));
				throw new Error("aborted");
			}),
		});
		expect(await executeReview(job, ctrl.signal, d)).toBe("cancelled");
		expect(d.end).toHaveBeenCalledWith("rev1", "cancelled");
	});
});

describe("toFindings", () => {
	it("keeps the canvas's keys, maps them to ids, and caps the list", () => {
		const raw = Array.from({ length: 40 }, () => ({
			severity: "info" as const,
			category: "performance" as const,
			message: "m",
			suggestedFix: "",
			blockKeys: ["missing_1"],
		}));
		const out = toFindings(raw, canvas.blocks);
		expect(out).toHaveLength(30);
		// an unknown key leaves a finding about the whole canvas
		expect(out[0]).toEqual({
			severity: "info",
			category: "performance",
			message: "m",
			blockKeys: [],
			blockIds: [],
		});
	});
});

describe("tooBig", () => {
	const limits = { idleMs: 1, callMs: 1, toolMs: 1, retries: 0 };
	it("lets a canvas through that fits the window and budget", () => {
		expect(tooBig("x".repeat(4000), limits)).toBeUndefined();
	});
	it("refuses one past the window", () => {
		expect(tooBig("x".repeat(4 * 120_000), limits)).toContain("120k tokens");
	});
	it("refuses one past the token budget", () => {
		expect(tooBig("x".repeat(4 * 20_000), { ...limits, tokenBudget: 10_000 })).toContain("2k");
	});
});
