import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import type { AdminFetch } from "../mcp/adminApi";
import { assertEndsOnUserOrTool, runAgent } from "./agent";
import { parseTasks } from "./evals/run";
import { ADVANCED, CORE, agentTools } from "./tools";

const limits = { idleMs: 1000, callMs: 5000, toolMs: 1000 };
const P = "019a0000-0000-7000-8000-000000000000";
type Call = { method: string; path: string; auth?: string; body?: unknown };

/** An in-process admin API: records each call and answers from `answer(path)`. */
function fakeFetch(answer: (path: string) => unknown = () => ({ id: "new-id" })) {
	const calls: Call[] = [];
	const fetcher: AdminFetch = (path, init) => {
		const headers = init.headers as Record<string, string>;
		calls.push({
			method: init.method ?? "GET",
			path: path.replace("/_/admin/api", ""),
			auth: headers.authorization,
			...(init.body ? { body: JSON.parse(init.body as string) } : {}),
		});
		const body = answer(path);
		return body instanceof Response ? body : Response.json(body);
	};
	return { fetcher, calls };
}

const setup = (answer?: (path: string) => unknown) => {
	const { fetcher, calls } = fakeFetch(answer);
	return { ...agentTools(fetcher, { authorization: "Bearer pat-1" }, P), calls };
};
const exec = (t: any, input: unknown) => t.execute(input, { toolCallId: "c1", messages: [] });

describe("agent tools", () => {
	it("wraps an MCP tool as-is and sends the PAT", async () => {
		const { tools, calls } = setup();
		const input = { projectId: P, name: "health", path: "/health", method: "GET" };
		expect(await exec(tools.save_route, input)).toEqual({ id: "new-id" });
		expect(calls).toEqual([
			{ method: "POST", path: "/v1/routes", auth: "Bearer pat-1", body: input },
		]);
	});

	it("list reads every type for the project in one call and keeps errors per type", async () => {
		const { tools, calls } = setup((path) =>
			path.includes("middlewares")
				? Response.json({ message: "nope" }, { status: 403 })
				: { data: [{ id: "r1", name: "a" }], pagination: { page: 1, hasNext: false } },
		);
		const out = await exec(tools.list, { types: ["routes", "middlewares"] });
		expect(out.routes.items[0]).toMatchObject({ id: "r1" });
		expect(out.middlewares).toEqual({ error: "You need the Viewer role in this project." });
		expect(calls.map((c) => c.path).sort()).toEqual([
			`/v1/middlewares/list?projectId=${P}`,
			`/v1/routes/list?projectId=${P}&perPage=50`,
		]);
	});

	it("get maps a type and id to the right get_* tool", async () => {
		const { tools, calls } = setup(() => ({ id: "x" }));
		await exec(tools.get, { type: "trigger", id: "t1" });
		await exec(tools.get, { type: "integration", id: "i1" });
		await exec(tools.get, { type: "app_config", id: "7" });
		expect(calls.map((c) => c.path)).toEqual([
			"/v1/triggers/t1",
			`/v1/${P}/integrations/i1`,
			`/v1/${P}/app-config/7`,
		]);
	});

	it("starts with only the core, and load_tools adds known advanced tools", async () => {
		const { tools, active } = setup();
		expect(active().sort()).toEqual([...CORE].sort());
		for (const name of CORE) expect(tools[name]).toBeDefined();
		expect(ADVANCED.map((t) => t.name)).toContain("delete_route");
		expect(ADVANCED.map((t) => t.name)).not.toContain("list_routes");
		const listed = await exec(tools.list_advanced_tools, {});
		expect(listed.some((l: string) => l.startsWith("delete_route: "))).toBe(true);
		expect(await exec(tools.load_tools, { names: ["delete_route", "nope"] })).toEqual({
			loaded: ["delete_route"],
			unknown: ["nope"],
		});
		expect(active()).toContain("delete_route");
	});
});

const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const reply = (parts: object[], reason: "tool-calls" | "stop") => ({
	stream: convertArrayToReadableStream([
		{ type: "stream-start", warnings: [] },
		...parts,
		{ type: "finish", finishReason: { unified: reason, raw: reason }, usage },
	] as any),
});
const call = (toolName: string, input: object) => ({
	type: "tool-call",
	toolCallId: `call-${toolName}`,
	toolName,
	input: JSON.stringify(input),
});

describe("agent loop", () => {
	it("exposes a loaded tool from the next step, and every request ends on user or tool", async () => {
		const seen: { tools: string[]; lastRole: string }[] = [];
		const answers = [
			reply([call("load_tools", { names: ["delete_route"] })], "tool-calls"),
			reply([call("delete_route", { routeId: "r1" })], "tool-calls"),
			reply([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "done" }, { type: "text-end", id: "t" }], "stop"),
		];
		const model = new MockLanguageModelV4({
			doStream: async (options) => {
				seen.push({
					tools: (options.tools ?? []).map((t) => t.name),
					lastRole: options.prompt.at(-1)!.role,
				});
				return answers[seen.length - 1] as any;
			},
		});
		const { tools, active, calls } = setup();
		const history: ModelMessage[] = [{ role: "user", content: "delete r1" }];
		const result = runAgent({ model, tools, active, projectId: P, history, limits });
		expect(await result.text).toBe("done");
		expect(seen[0].tools).not.toContain("delete_route");
		expect(seen[1].tools).toContain("delete_route");
		expect(seen.map((s) => s.lastRole)).toEqual(["user", "tool", "tool"]);
		expect(calls).toContainEqual({ method: "DELETE", path: "/v1/routes/r1", auth: "Bearer pat-1" });
		expect(history.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);
	});

	it("refuses a history that ends on assistant or system", () => {
		expect(() => assertEndsOnUserOrTool([{ role: "assistant", content: "hi" }])).toThrow(
			'last message is "assistant"',
		);
		expect(() => assertEndsOnUserOrTool([{ role: "user", content: "hi" }])).not.toThrow();
	});
});

describe("eval tasks", () => {
	it("parses tasks.md into 10 prompts, with setup split out and checks left out", async () => {
		const tasks = parseTasks(await Bun.file(`${import.meta.dir}/evals/tasks.md`).text());
		expect(tasks.map((t) => t.n)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
		expect(tasks.every((t) => t.prompt && !t.prompt.includes("Check:"))).toBe(true);
		expect(tasks[5].setup).toStartWith("Build GET /broken");
		expect(tasks[5].prompt).not.toContain("Setup:");
	});
});
