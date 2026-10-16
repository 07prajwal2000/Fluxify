import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { AdminFetch } from "../mcp/adminApi";
import { type Approval, assertEndsOnUserOrTool, runAgent } from "./agent";
import { withoutBudget } from "./budget.fixture";
import { limits, reply, text } from "./modes.fixture";
import type { Planning } from "./planning";
import { continueConversation } from "./resume";
import type { AgentStore } from "./store";
import { applyTodos, type Todo } from "./todos";
import { agentTools, type Mode } from "./tools";

const fetcher = (async () => new Response("{}")) as unknown as AdminFetch;
const SUGGEST = 'suggest_plan_mode|{"reason":"three routes"}';
const open = applyTodos([], { items: [{ text: "a" }] }) as Todo[];

/** Each entry of `steps` is the calls of one step ("name|{json}"), then "done". */
function scripted(steps: string[][]) {
	const prompts: { tools: string[]; messages: ModelMessage[] }[] = [];
	const model = new MockLanguageModelV4({
		doStream: async (o) => {
			prompts.push({ tools: (o.tools ?? []).map((t) => t.name), messages: o.prompt as ModelMessage[] });
			const names = steps[prompts.length - 1];
			if (!names) return reply(text("done"), "stop") as any;
			const calls = names.map((n, i) => ({
				type: "tool-call",
				toolCallId: `c${prompts.length}-${i}`,
				toolName: n.split("|")[0],
				input: n.split("|")[1] ?? "{}",
			}));
			return reply(calls, "tool-calls") as any;
		},
	});
	return { model, prompts };
}

async function go(
	steps: string[][],
	plan: Planning,
	answer: () => Approval = () => ({ ok: true }),
	allowed = new Set<string>(),
) {
	const { tools, active } = agentTools(fetcher, {}, "p", new Set(), plan);
	const { model, prompts } = scripted(steps);
	const asked: string[] = [];
	const history: ModelMessage[] = [{ role: "user", content: "go" }];
	const r = runAgent({
		model,
		tools,
		active,
		projectId: "p",
		history,
		limits,
		mode: plan.mode,
		plan,
		allowed,
		approve: async (c) => {
			asked.push(c.toolName);
			return answer();
		},
	});
	await r.consumeStream();
	const results = history
		.flatMap((m) => (m.role === "tool" ? m.content : []))
		.filter((p) => p.type === "tool-result") as any[];
	return { prompts, asked, results };
}

const offered = (p: { tools: string[] }) => ({
	todos: p.tools.includes("update_todos"),
	suggest: p.tools.includes("suggest_plan_mode"),
});

describe("update_todos visibility (#771)", () => {
	it("is hidden until a plan is approved; suggest_plan_mode is offered", async () => {
		const r = await go([], { mode: "manual", todos: [] });
		expect(offered(r.prompts[0])).toEqual({ todos: false, suggest: true });
	});

	it("after approval: offered, returns the whole list and the next task, gone once all is done", async () => {
		const plan: Planning = { mode: "manual", approved: true, todos: [] };
		const r = await go(
			[
				['update_todos|{"items":[{"text":"a","subtasks":[{"text":"a1"}]},{"text":"b"}]}'],
				['update_todos|{"id":"1.1","status":"done"}'],
				['update_todos|{"id":"2","status":"dropped"}'],
			],
			plan,
		);
		expect(r.asked).toEqual([]);
		expect(r.prompts.map((p) => offered(p).todos)).toEqual([true, true, true, false]);
		const first = r.results[0].output.value;
		expect(first.todos.map((t: Todo) => t.id)).toEqual(["1", "2"]);
		expect(first.next).toMatchObject({ id: "1.1", text: "a1" });
		expect(r.results[1].output.value.next).toMatchObject({ id: "2" });
		expect(r.results[2].output.value.next).toBeNull();
		expect(plan.todos.map((t) => t.status)).toEqual(["done", "dropped"]);
		expect(r.prompts[0].messages[0].content).toContain("The user approved your plan");
		for (const p of r.prompts) assertEndsOnUserOrTool(withoutBudget(p.messages));
	});

	it("a cleared list hides it again", async () => {
		const r = await go(
			[['update_todos|{"items":[{"text":"a"}]}'], ['update_todos|{"items":[]}']],
			{ mode: "auto", approved: true, todos: [] },
		);
		expect(r.prompts.map((p) => offered(p).todos)).toEqual([true, true, false]);
	});

	it("stays offered while an earlier list has open items, with no approval", async () => {
		const r = await go([], { mode: "auto", todos: open });
		expect(offered(r.prompts[0]).todos).toBe(true);
		expect(r.prompts[0].messages[0].content).not.toContain("The user approved your plan");
	});

	it("a refused write goes back to the model as an error", async () => {
		const items = Array.from({ length: 31 }, (_, i) => ({ text: `t${i}` }));
		const r = await go([[`update_todos|${JSON.stringify({ items })}`]], { mode: "auto", approved: true, todos: [] });
		expect(r.results[0].output).toMatchObject({ type: "error-text" });
		expect(r.results[0].output.value).toContain("31 items");
	});

	it("plan mode offers neither tool", async () => {
		const r = await go([], { mode: "plan", approved: true, todos: open });
		expect(offered(r.prompts[0])).toEqual({ todos: false, suggest: false });
	});
});

describe("suggest_plan_mode (#771)", () => {
	it("asks even in auto and is never approved for the session", async () => {
		const allowed = new Set<string>();
		const r = await go([[SUGGEST], [SUGGEST]], { mode: "auto", todos: [] }, () => ({ ok: true, always: true }), allowed);
		expect(r.asked).toEqual(["suggest_plan_mode", "suggest_plan_mode"]);
		expect(allowed.size).toBe(0);
		expect(r.results[0].output.value).toContain("continue without a plan");
	});

	it("Switch to plan: the approval continues the run in plan mode and the model is told so", async () => {
		const rows: ModelMessage[] = [];
		const store = {
			append: async (_c: string, _r: string, list: ModelMessage[]) => {
				rows.push(...structuredClone(list));
				return list.map((_, i) => rows.length - list.length + i);
			},
			appendSummary: async () => 0,
			modelView: async () => rows.map((message, seq) => ({ message: structuredClone(message), seq })),
			setRunStatus: async () => {},
		} as unknown as AgentStore;
		const turn = async (mode: Mode, steps: string[][], input: object) => {
			const plan: Planning = { mode, todos: [] };
			const { tools, active } = agentTools(fetcher, {}, "p", new Set(), plan);
			const { model, prompts } = scripted(steps);
			const agent = { model, tools, active, projectId: "p", limits, mode, plan };
			const r = await continueConversation({
				store,
				conversationId: "c",
				runId: "r",
				agent: { ...agent, approve: async () => ({ ok: false, defer: true }) },
				...input,
			});
			if (r.result) await r.result.consumeStream();
			return { status: await r.status, prompts };
		};
		expect((await turn("auto", [[SUGGEST]], { message: "build three routes" })).status).toBe(
			"waiting_approval",
		);
		// answerApproval queues the continue job in the mode the user picked
		const next = await turn("plan", [], { approval: { ok: true } });
		expect(next.status).toBe("completed");
		const decided = rows.find((m) => m.role === "tool") as any;
		expect(decided.content[0].output.value).toContain("User switched to plan mode");
		expect(next.prompts[0].messages[0].content).toContain("Plan mode:");
		expect(next.prompts[0].tools).not.toContain("save_route");
	});
});
