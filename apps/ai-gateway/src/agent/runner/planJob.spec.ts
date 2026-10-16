import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import type { AdminFetch } from "../../mcp/adminApi";
import { json, scripted } from "../resume.fixture";
import type { AgentStore, RunStatus } from "../store";
import { agentTools } from "../tools";
import { executeRun, type RunDeps } from "./job";
import type { AgentJob } from "./queue";

const fetcher = (async () => Response.json({})) as unknown as AdminFetch;

/** An approved-plan run whose first job waits on an approval (#771): what each job is built with. */
function world(script: string[][], rows: ModelMessage[] = []) {
	const state = { run: "queued" as RunStatus };
	const built: { approved?: boolean; offered: string[] }[] = [];
	const m = scripted(script);
	const store = {
		append: async (_c: string, _r: string, list: ModelMessage[]) =>
			list.map((msg) => rows.push(json(msg)) - 1),
		modelView: async () => rows.map((message, seq) => ({ message: json(message), seq })),
		all: async () => rows.map((content, seq) => ({ seq, role: content.role, content: json(content) })),
		setRunStatus: async (_r: string, s: RunStatus) => {
			state.run = s;
		},
	} as unknown as AgentStore;
	const deps: RunDeps = {
		store,
		claimRun: async () => state.run === "queued",
		settle: async () => {},
		// as the worker builds it
		build: async (job, loaded, todos = []) => {
			const plan = { mode: job.mode, approved: job.planApproved, todos };
			const { tools, active } = agentTools(fetcher, {}, "p", loaded, plan);
			built.push({ approved: job.planApproved, offered: active() });
			const { approve: _, ...agent } = m.agent;
			return { ...agent, tools, active, plan };
		},
		publish: async () => {},
		batchMs: 1,
	};
	const job = (over: Partial<AgentJob>): AgentJob => ({
		type: "continue",
		conversationId: "c",
		runId: "r",
		userId: "u",
		projectId: "p",
		mode: "manual",
		planApproved: true,
		...over,
	});
	const go = async (over: Partial<AgentJob>) => {
		state.run = "queued";
		return executeRun(job(over), deps, new AbortController().signal);
	};
	return { go, built, prompts: m.prompts, rows };
}

const system = (p: ModelMessage[]) => String(p[0]?.content);

describe("an approved plan across the jobs of a run (#771)", () => {
	it("a continue job after an approval wait still gets the instruction and update_todos", async () => {
		const w = world([["save_route"]]);
		expect(await w.go({ type: "start", message: "go ahead" })).toBe("waiting_approval");
		// answerApproval carries planApproved from the conversation into the continue job
		expect(await w.go({ approval: { ok: true } })).toBe("completed");
		expect(w.built.map((b) => b.approved)).toEqual([true, true]);
		expect(w.built.every((b) => b.offered.includes("update_todos"))).toBe(true);
		for (const p of w.prompts) expect(system(p)).toContain("The user approved your plan");
	});

	it("once the run wrote the list, a continue job works from it without the instruction", async () => {
		const rows: ModelMessage[] = [
			{ role: "user", content: "go ahead" },
			{
				role: "assistant",
				content: [{ type: "tool-call", toolCallId: "t", toolName: "update_todos", input: { items: [{ text: "a" }] } }],
			},
			{
				role: "tool",
				content: [{ type: "tool-result", toolCallId: "t", toolName: "update_todos", output: { type: "json", value: {} } }],
			},
			{ role: "assistant", content: [{ type: "tool-call", toolCallId: "s", toolName: "save_route", input: {} }] },
		];
		const w = world([], rows);
		expect(await w.go({ approval: { ok: true } })).toBe("completed");
		expect(w.built[0].approved).toBe(false);
		// the open list keeps the tool
		expect(w.built[0].offered).toContain("update_todos");
		expect(system(w.prompts[0])).not.toContain("The user approved your plan");
	});
});
