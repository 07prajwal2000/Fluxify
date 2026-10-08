import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ModelMessage } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import type { AdminFetch } from "../../mcp/adminApi";
import {
	calledTool,
	type Ctx,
	expectCall,
	matches,
	runCheck,
	scheduleTrigger,
	suitesPass,
	type Task,
} from "./checks";
import { judge, judgeFromEnv, judgePrompt, transcript } from "./judge";
import { appendResults, RESULTS_HEADER, type Row, resultsRow, table } from "./report";
import { type Deps, pickTasks, retryRateLimit, runAll, runTask } from "./run";
import { tasks } from "./tasks";

const P = "019a0000-0000-7000-8000-000000000000";

const usage = {
	inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const finish = (reason: string) => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });
const text = (t: string) => [
	{ type: "text-start", id: "t" },
	{ type: "text-delta", id: "t", delta: t },
	{ type: "text-end", id: "t" },
];
const toolCall = (toolName: string, input: object) => ({
	type: "tool-call",
	toolCallId: `call-${toolName}`,
	toolName,
	input: JSON.stringify(input),
});
const stream = (parts: object[], reason: string) => ({
	stream: convertArrayToReadableStream([{ type: "stream-start", warnings: [] }, ...parts, finish(reason)] as any),
});

/** A model that saves GET /health, then says done; every later prompt just gets "done". */
function agentModel() {
	let n = 0;
	return new MockLanguageModelV4({
		doStream: async () =>
			(n++ === 0
				? stream([toolCall("save_route", { projectId: P, name: "health", path: "/health", method: "GET", active: true })], "tool-calls")
				: stream(text("done"), "stop")) as any,
	});
}

type Call = { method: string; path: string; body?: any };

/** An in-memory admin API: one project P whose routes live in `routes`. */
function fakeAdmin(routes: any[] = []) {
	const calls: Call[] = [];
	const paged = (data: unknown[]) => ({ data, pagination: { page: 1, hasNext: false } });
	const fetcher: AdminFetch = (full, init) => {
		const p = full.replace("/_/admin/api", "").split("?")[0];
		const method = init.method ?? "GET";
		const body = init.body ? JSON.parse(init.body as string) : undefined;
		calls.push({ method, path: p, ...(body ? { body } : {}) });
		const answer = (() => {
			if (method === "POST" && p === "/v1/projects") return { id: P };
			if (method === "PUT" && p === `/v1/projects/${P}`) return { id: P, ...body };
			if (method === "POST" && p === "/v1/routes") {
				routes.push({ id: `r${routes.length + 1}`, ...body });
				return { id: `r${routes.length}` };
			}
			if (method === "DELETE" && p.startsWith("/v1/routes/")) {
				routes.splice(routes.findIndex((r) => r.id === p.split("/").at(-1)), 1);
				return { id: "x" };
			}
			if (method === "POST" && p.endsWith("/call")) return { status: 200, body: { status: "ok" } };
			if (p === "/v1/routes/list") return paged(routes);
			if (p.endsWith("/list") && !p.includes("middlewares") && !p.includes("custom-blocks")) return paged([]);
			return [];
		})();
		return Response.json(answer);
	};
	return { fetcher, calls, routes };
}

const deps = (over: Partial<Deps> = {}): Deps & { out: string[] } => {
	const out: string[] = [];
	return {
		...fakeAdmin(),
		auth: { authorization: "Bearer pat" },
		model: agentModel(),
		limits: { idleMs: 1000, callMs: 5000, toolMs: 1000, retries: 0 },
		env: {},
		outDir: mkdtempSync(path.join(tmpdir(), "evals-")),
		write: (s) => out.push(s),
		out,
		...over,
	};
};

const healthTask: Task = {
	id: "health",
	title: "health",
	prompt: "Build GET /health",
	checks: [
		expectCall("ok", "GET", "/health", {}, { status: 200, body: { status: "ok" } }),
		calledTool("save_route"),
	],
	judge: ["Checked its work"],
};

const ctxWith = (tool: (name: string, args: any) => unknown, calls: Ctx["calls"] = []): Ctx => ({
	projectId: "p1",
	tool: async (n, a) => tool(n, a),
	api: {} as Ctx["api"],
	seed: {},
	calls,
	env: {},
});

describe("check helpers", () => {
	it("matches a subset of objects, arrays in full", () => {
		expect(matches({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 2 } })).toBe(true);
		expect(matches({ a: [1, 2] }, { a: [1] })).toBe(false);
		expect(matches("x", { a: 1 })).toBe(false);
	});

	it("expectCall finds the route by method and path and compares status and body", async () => {
		const tool = (name: string, a: any) =>
			name === "list_routes"
				? { items: [{ id: "r1", method: "GET", path: "/health", active: true }] }
				: { status: a.routeId === "r1" ? 200 : 404, body: { status: "ok", extra: 1 } };
		expect((await runCheck(expectCall("ok", "GET", "/health", {}, { status: 200, body: { status: "ok" } }), ctxWith(tool))).pass).toBe(true);
		const wrong = await runCheck(expectCall("ok", "GET", "/health", {}, { status: 201 }, 1), ctxWith(tool));
		expect(wrong).toEqual({ pass: false, message: 'got 200 {"status":"ok","extra":1}' });
		const missing = await runCheck(expectCall("ok", "GET", "/nope", {}, {}), ctxWith(tool));
		expect(missing).toEqual({ pass: false, message: "No route GET /nope" });
	});

	it("calledTool reads the agent's calls", async () => {
		const ctx = ctxWith(() => null, [{ name: "get_recording", input: {} }]);
		expect((await calledTool("get_recording").run(ctx)).pass).toBe(true);
		expect((await calledTool("get_system_logs").run(ctx)).pass).toBe(false);
	});

	it("scheduleTrigger wants an active schedule on the named workflow", async () => {
		const trigger = { id: "t1", type: "schedule", active: true, workflow: { name: "nightly" } };
		const tool = (name: string) =>
			name === "list_triggers" ? { items: [trigger] } : { schedule: "0 0 2 * * *" };
		const check = scheduleTrigger("nightly", (s) => s === "0 0 2 * * *", "02:00");
		expect((await check.run(ctxWith(tool))).pass).toBe(true);
		trigger.active = false;
		expect(await check.run(ctxWith(tool))).toEqual({
			pass: false,
			message: "schedule triggers: 0 0 2 * * * (inactive, nightly)",
		});
	});

	it("suitesPass runs every suite and fails without one", async () => {
		let suites = [{ id: "s1", name: "a" }];
		const ran: string[] = [];
		const tool = (name: string, a: any) => {
			if (name === "list_routes") return { items: [{ id: "r1", method: "GET", path: "/add" }] };
			if (name === "list_test_suites") return suites;
			ran.push(a.testSuiteId);
			return { status: "passed" };
		};
		expect((await suitesPass("GET", "/add").run(ctxWith(tool))).pass).toBe(true);
		expect(ran).toEqual(["s1"]);
		suites = [];
		expect(await suitesPass("GET", "/add").run(ctxWith(tool))).toEqual({ pass: false, message: "no test suite" });
	});
});

describe("tasks", () => {
	it("has 15 tasks with unique ids, prompts, checks and a checklist", () => {
		expect(tasks).toHaveLength(15);
		expect(new Set(tasks.map((t) => t.id)).size).toBe(15);
		for (const t of tasks) {
			expect([t.prompt].flat().every(Boolean)).toBe(true);
			expect(t.checks.length).toBeGreaterThan(0);
			expect(t.judge.length).toBeGreaterThan(0);
		}
		expect(Array.isArray(tasks.find((t) => t.id === "multi-turn")?.prompt)).toBe(true);
	});

	it("--task also finds the tasks in tasks2", () => {
		expect(pickTasks("greeting-expression").map((t) => t.id)).toEqual(["greeting-expression"]);
		expect(pickTasks("broken-sql")[0]?.needsEnv).toEqual(["EVAL_POSTGRES_URL"]);
	});

	it("--task picks in suite order and refuses unknown ids", () => {
		expect(pickTasks("echo,health").map((t) => t.id)).toEqual(["health", "echo"]);
		expect(() => pickTasks("health,nope")).toThrow("Unknown task(s): nope");
	});
});

describe("runTask", () => {
	it("creates a project, runs setup, the agent and the checks, then empties and hides the project", async () => {
		const d = deps();
		let setupProject = "";
		const row = await runTask({ ...healthTask, setup: async (ctx) => void (setupProject = ctx.projectId) }, d, new AbortController().signal);
		expect(setupProject).toBe(P);
		expect(row.checks.map((c) => c.pass)).toEqual([true, true]);
		expect(row).toMatchObject({ steps: 2, tokensIn: 20, tokensOut: 10, stop: "stop", judge: "skipped" });
		const calls = (d as any).calls as Call[];
		expect(calls[0]).toMatchObject({ method: "POST", path: "/v1/projects" });
		expect(calls).toContainEqual({ method: "DELETE", path: "/v1/routes/r1" });
		expect(calls.at(-1)).toEqual({ method: "PUT", path: `/v1/projects/${P}`, body: { hidden: true } });
		const saved = JSON.parse(readFileSync(path.join(d.outDir, "health.json"), "utf8"));
		expect(saved[0]).toEqual({ role: "user", content: "Build GET /health" });
		expect(readFileSync(path.join(d.outDir, "health.log"), "utf8")).toContain("PASS ok");
		expect(readFileSync(path.join(d.outDir, "health.judge.md"), "utf8")).toContain("1. Checked its work");
	});

	it("still cleans up when setup throws, and records the error", async () => {
		const d = deps();
		const row = await runTask({ ...healthTask, setup: async () => { throw new Error("boom"); } }, d, new AbortController().signal);
		expect(row).toMatchObject({ error: "boom", stop: "error" });
		expect((d as any).calls.at(-1)).toMatchObject({ path: `/v1/projects/${P}`, body: { hidden: true } });
	});

	it("answers no at a limit and records it as the stop", async () => {
		const d = deps({ limits: { idleMs: 1000, callMs: 5000, toolMs: 1000, retries: 0, maxSteps: 1 } });
		const row = await runTask(healthTask, d, new AbortController().signal);
		expect(row).toMatchObject({ steps: 1, stop: "step-limit" });
	});

	it("--keep leaves the project", async () => {
		const d = deps({ keep: true });
		await runTask(healthTask, d, new AbortController().signal);
		expect((d as any).calls.some((c: Call) => c.method === "PUT")).toBe(false);
	});

	it("skips a task whose env var is missing, without a project", async () => {
		const d = deps();
		const row = await runTask({ ...healthTask, needsEnv: ["EVAL_X"] }, d, new AbortController().signal);
		expect(row.stop).toBe("skipped: needs EVAL_X");
		expect((d as any).calls).toEqual([]);
	});

	it("runs every turn of a multi-turn task on one conversation", async () => {
		const d = deps();
		await runTask({ ...healthTask, prompt: ["first", "second"] }, d, new AbortController().signal);
		const saved: ModelMessage[] = JSON.parse(readFileSync(path.join(d.outDir, "health.json"), "utf8"));
		expect(saved.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["first", "second"]);
	});

	it("a stop marks the task aborted, skips its checks and still cleans up", async () => {
		const d = deps();
		const ctrl = new AbortController();
		ctrl.abort(new Error("Stopped by user"));
		const row = await runTask(healthTask, d, ctrl.signal);
		expect(row).toMatchObject({ stop: "aborted", checks: [] });
		expect((d as any).calls.at(-1)).toMatchObject({ body: { hidden: true } });
	});

	it("scores the checklist with the judge model", async () => {
		const judgeModel = new MockLanguageModelV4({
			doGenerate: async () => ({
				content: [{ type: "text", text: JSON.stringify({ items: [{ item: "Checked its work", pass: true, reason: "called it" }] }) }],
				finishReason: { unified: "stop", raw: "stop" },
				usage,
				warnings: [],
			}) as any,
		});
		const row = await runTask(healthTask, deps({ judgeModel }), new AbortController().signal);
		expect(row.judge).toBe(1);
	});
});

describe("runAll", () => {
	it("a crashing task does not stop the others; the table is printed and saved", async () => {
		const d = deps();
		const crash: Task = { ...healthTask, id: "crash", setup: async () => { throw new Error("kaboom"); } };
		const { rows, report } = await runAll([crash, healthTask], d, {});
		expect(rows.map((r) => r.id)).toEqual(["crash", "health"]);
		expect(report).toContain("| crash | FAIL 0/0 |");
		expect(report).toContain("| health | PASS 2/2 | skipped | 2 | 20/10 |");
		expect(report).toContain("- crash: error: kaboom");
		expect(readFileSync(path.join(d.outDir, "results.md"), "utf8")).toContain("| health |");
	});

	it("stops between tasks once stopped", async () => {
		const { rows } = await runAll([healthTask, healthTask], deps(), { stopped: true });
		expect(rows).toEqual([]);
	});
});

describe("judge", () => {
	it("is skipped without AGENT_JUDGE_* and built from them with", () => {
		expect(judgeFromEnv({})).toBeUndefined();
		const m = judgeFromEnv({ AGENT_JUDGE_PROVIDER: "openai", AGENT_JUDGE_MODEL: "gpt-5", AGENT_JUDGE_API_KEY: "k" }) as any;
		expect(m.modelId).toBe("gpt-5");
	});

	it("keeps the checklist's order and fails items the model skipped", async () => {
		const model = new MockLanguageModelV4({
			doGenerate: async () => ({
				content: [{ type: "text", text: JSON.stringify({ items: [{ item: "b", pass: true, reason: "yes" }] }) }],
				finishReason: { unified: "stop", raw: "stop" },
				usage,
				warnings: [],
			}) as any,
		});
		const v = await judge(model, "p", ["a", "b"]);
		expect(v.items).toEqual([
			{ item: "a", pass: true, reason: "yes" },
			{ item: "b", pass: true, reason: "yes" },
		]);
		expect(v.score).toBe(1);
	});

	it("puts tool calls and trimmed results in the transcript and cuts a long one", () => {
		const history: ModelMessage[] = [
			{ role: "user", content: "hi" },
			{ role: "assistant", content: [{ type: "tool-call", toolCallId: "1", toolName: "call_route", input: { routeId: "r1" } }] },
			{ role: "tool", content: [{ type: "tool-result", toolCallId: "1", toolName: "call_route", output: { type: "json", value: { body: "x".repeat(2000) } } }] },
		];
		const t = transcript(history);
		expect(t).toContain('TOOL CALL call_route {"routeId":"r1"}');
		expect(t).toMatch(/TOOL RESULT call_route .*… \(2011 chars\)/);
		const long = transcript(Array.from({ length: 200 }, () => ({ role: "user" as const, content: "y".repeat(500) })));
		expect(long.length).toBeLessThan(61_000);
		expect(long).toContain("chars cut");
		expect(judgePrompt("task", ["a"], history)).toContain("1. a");
	});
});

describe("report", () => {
	const rows: Row[] = [
		{ id: "a", checks: [{ name: "x", pass: true, message: "" }], judge: 1, steps: 3, tokensIn: 100, tokensOut: 10, ms: 4000, stop: "stop" },
		{ id: "b", checks: [{ name: "y", pass: false, message: "got 500" }], judge: 0.5, steps: 40, tokensIn: 900, tokensOut: 90, ms: 6000, stop: "step-limit" },
		{ id: "c", checks: [], judge: "skipped", steps: 0, tokensIn: 0, tokensOut: 0, ms: 0, stop: "skipped: needs X" },
	];

	it("prints each task and its failures", () => {
		const t = table(rows);
		expect(t).toContain("| a | PASS 1/1 | 100% | 3 | 100/10 | 4s | stop |");
		expect(t).toContain("| b | FAIL 0/1 | 50% | 40 | 900/90 | 6s | step-limit |");
		expect(t).toContain("| c | - | skipped |");
		expect(t).toContain("- b: y: got 500");
	});

	it("appends one summary row, not counting skipped tasks", () => {
		const file = path.join(mkdtempSync(path.join(tmpdir(), "results-")), "results.md");
		writeFileSync(file, RESULTS_HEADER);
		appendResults(file, resultsRow(rows, "poolside/laguna-xs-2.1", new Date("2026-10-08T00:00:00Z")));
		expect(readFileSync(file, "utf8").trim().split("\n").at(-1)).toBe(
			"| 2026-10-08 | poolside/laguna-xs-2.1 | 1/2 | 75% | 1100 | 10s |",
		);
		expect(resultsRow([{ ...rows[0], judge: "skipped" }], "m")).toContain("| 1/1 | skipped |");
	});
});

describe("retryRateLimit", () => {
	it("waits out a 429 and returns the next answer", async () => {
		let n = 0;
		const f = retryRateLimit(() => (n++ < 2 ? new Response("", { status: 429 }) : Response.json({ ok: true })), 5, 1);
		expect(await (await f("/x", {})).json()).toEqual({ ok: true });
		expect(n).toBe(3);
	});
});
