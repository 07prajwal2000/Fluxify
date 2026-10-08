import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import type { AdminFetch } from "../mcp/adminApi";
import { type Approval, runAgent } from "./agent";
import { printRun } from "./progress";
import { agentTools, loadedTools, type Mode } from "./tools";

const P = "019a0000-0000-7000-8000-000000000000";
const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const reply = (parts: object[], reason: "stop" | "tool-calls") => ({
	stream: convertArrayToReadableStream([
		...parts,
		{ type: "finish", finishReason: { unified: reason, raw: reason }, usage },
	] as any),
});
const say = (s: string) => [
	{ type: "text-start", id: "t" },
	{ type: "text-delta", id: "t", delta: s },
	{ type: "text-end", id: "t" },
];

/** The model calls `calls` (name, input) one per step, then says "done". */
async function run(
	calls: [string, object][],
	mode: Mode = "auto",
	opts: { loaded?: Set<string>; approve?: (name: string) => Approval } = {},
) {
	const fetched: string[] = [];
	const fetcher: AdminFetch = (path) => {
		fetched.push(path);
		return Response.json({ data: [], pagination: { page: 1, perPage: 50, total: 0, totalPages: 1 } });
	};
	const asked: string[] = [];
	const loaded = opts.loaded ?? new Set<string>();
	const { tools, active, load } = agentTools(fetcher, {}, P, loaded);
	const prompts: string[][] = [];
	const model = new MockLanguageModelV4({
		doStream: async (o) => {
			prompts.push((o.tools ?? []).map((t) => t.name));
			const next = calls[prompts.length - 1];
			if (!next) return reply(say("done"), "stop") as any;
			const call = {
				type: "tool-call",
				toolCallId: `c${prompts.length}`,
				toolName: next[0],
				input: JSON.stringify(next[1]),
			};
			return reply([call], "tool-calls") as any;
		},
	});
	const history: ModelMessage[] = [{ role: "user", content: "go" }];
	const result = runAgent({
		model,
		tools,
		active,
		load,
		projectId: P,
		history,
		limits: { idleMs: 1000, callMs: 1000, toolMs: 1000, retries: 0 },
		mode,
		approve: async (c) => {
			asked.push(c.toolName);
			return opts.approve?.(c.toolName) ?? { ok: true };
		},
	});
	await printRun(result, { write: () => {} });
	const results = history.flatMap((m) =>
		m.role === "tool" ? m.content.map((p) => JSON.stringify(p)) : [],
	);
	return { fetched, asked, prompts, history, results, loaded, stopped: result.stopped() };
}

describe("auto-load an unloaded advanced tool (#699)", () => {
	it("runs it in the same step, with no error, and keeps it loaded", async () => {
		const r = await run([["list_members", { projectId: P }], ["list_members", { projectId: P }]]);
		expect(r.fetched).toHaveLength(2);
		expect(r.results.join()).not.toContain("error");
		expect(r.prompts[0]).not.toContain("list_members");
		expect(r.prompts[1]).toContain("list_members");
		expect(r.stopped).toBeUndefined();
	});

	it("survives a resume: the rebuilt set has it", async () => {
		const r = await run([["list_members", { projectId: P }]]);
		expect([...loadedTools(r.history)]).toEqual(["list_members"]);
	});

	it("still asks for approval: a delete always, even auto-loaded", async () => {
		const r = await run([["delete_route", { projectId: P, routeId: "r1" }]], "auto");
		expect(r.asked).toEqual(["delete_route"]);
		const denied = await run([["delete_route", { projectId: P, routeId: "r1" }]], "auto", {
			approve: () => ({ ok: false }),
		});
		expect(denied.fetched).toHaveLength(0);
		expect(denied.results.join()).toContain("did not approve");
	});

	it("plan mode refuses an unloaded write tool, and does not load it", async () => {
		const r = await run([["delete_route", { projectId: P, routeId: "r1" }]], "plan");
		expect(r.fetched).toHaveLength(0);
		expect(r.asked).toEqual([]);
		expect(r.results.join()).toContain("plan mode is read-only");
		expect(r.loaded.size).toBe(0);
	});

	it("plan mode refuses a write tool that is core but not offered, too", async () => {
		const r = await run([["save_route", { projectId: P, name: "a", path: "/a", method: "GET" }]], "plan");
		expect(r.fetched).toHaveLength(0);
		expect(r.results.join()).toContain("plan mode is read-only");
	});

	it("an unknown name is still an error, with close matches", async () => {
		const r = await run([["delete_routes", {}]]);
		expect(r.results.join()).toContain("No tool named delete_routes");
		expect(r.results.join()).toContain("delete_route");
		expect(r.loaded.size).toBe(0);
	});

	it("a bad input to an unloaded tool is the normal input error", async () => {
		const r = await run([["list_members", {}]]);
		expect(r.fetched).toHaveLength(0);
		expect(r.results.join()).toContain("list_members");
	});
});
