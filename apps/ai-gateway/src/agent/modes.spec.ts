import { describe, expect, it } from "bun:test";
import { type ModelMessage, tool } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { type Approval, type PendingCall, runAgent } from "./agent";
import { cliApprover, converse, parseApproval, parseLine, parseStart } from "./cli";
import { describeCall, printRun } from "./progress";
import type { Mode } from "./tools";

const limits = { idleMs: 1000, callMs: 300, toolMs: 100, retries: 0 };
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
const text = (s: string) => [
	{ type: "text-start", id: "t" },
	{ type: "text-delta", id: "t", delta: s },
	{ type: "text-end", id: "t" },
];
const NAMES = ["save_route", "call_route", "get_canvas", "delete_route", "run_test_suite"];

/**
 * One run: each entry of `steps` is the tools the model calls in that step,
 * then it answers "done". Returns what was asked, what ran, and what the model saw.
 */
async function run(
	steps: string[][],
	mode: Mode,
	answer: (c: PendingCall) => Approval | Promise<Approval> = () => ({ ok: true }),
	opts: { allowed?: Set<string>; signal?: AbortSignal; slowTool?: number } = {},
) {
	const asked: string[] = [];
	const ran: string[] = [];
	const prompts: { tools: string[]; messages: ModelMessage[] }[] = [];
	const tools = Object.fromEntries(
		NAMES.map((n) => [
			n,
			tool({
				inputSchema: z.object({}).passthrough(),
				execute: async () => {
					if (opts.slowTool) await Bun.sleep(opts.slowTool);
					ran.push(n);
					return "ok";
				},
			}),
		]),
	);
	const model = new MockLanguageModelV4({
		doStream: async (o) => {
			prompts.push({ tools: (o.tools ?? []).map((t) => t.name), messages: o.prompt as ModelMessage[] });
			const names = steps[prompts.length - 1];
			if (!names) return reply(text("done"), "stop") as any;
			const calls = names.map((n, i) => ({
				type: "tool-call",
				toolCallId: `c${prompts.length}-${i}`,
				toolName: n,
				input: "{}",
			}));
			return reply(calls, "tool-calls") as any;
		},
	});
	const history: ModelMessage[] = [{ role: "user", content: "go" }];
	const result = runAgent({
		model,
		tools,
		active: () => NAMES,
		projectId: "p",
		history,
		limits,
		mode,
		allowed: opts.allowed,
		abortSignal: opts.signal,
		approve: async (c) => {
			asked.push(c.toolName);
			return answer(c);
		},
	});
	let shown = "";
	const events: string[] = [];
	await printRun(result, { write: (s) => (shown += s), log: (e) => events.push(e) });
	return { asked, ran, prompts, history, shown, events };
}

describe("what asks", () => {
	it("manual asks for a save and call_route, not for a read", async () => {
		const r = await run([["get_canvas", "save_route", "call_route"]], "manual");
		expect(r.asked).toEqual(["save_route", "call_route"]);
		expect(r.ran.sort()).toEqual(["call_route", "get_canvas", "save_route"]);
	});

	it("auto runs saves and call_route unasked but asks for a delete", async () => {
		const r = await run([["save_route", "call_route", "run_test_suite", "delete_route"]], "auto");
		expect(r.asked).toEqual(["delete_route"]);
		expect(r.ran).toHaveLength(4);
	});

	it("'always' skips later prompts for that tool, never for a delete", async () => {
		const allowed = new Set<string>();
		const always = (): Approval => ({ ok: true, always: true });
		const steps = [["save_route", "delete_route"], ["save_route", "delete_route"]];
		const r = await run(steps, "manual", always, { allowed });
		expect(r.asked).toEqual(["save_route", "delete_route", "delete_route"]);
		expect([...allowed]).toEqual(["save_route"]);
	});

	it("a rejection reason reaches the model as the tool result and the run goes on", async () => {
		const r = await run([["save_route"]], "manual", () => ({ ok: false, reason: "use /v2" }));
		expect(r.ran).toEqual([]);
		expect(r.prompts).toHaveLength(2);
		const last = r.prompts[1].messages.at(-1)!;
		expect(last.role).toBe("tool");
		expect(JSON.stringify(last.content)).toContain(
			"The user did not approve save_route: use /v2. Ask them, or continue without it.",
		);
		expect(r.shown).toContain("✗ save_route The user did not approve save_route: use /v2");
		expect(r.shown).toContain("done");
	});

	it("plan mode only exposes read tools", async () => {
		const r = await run([], "plan");
		expect(r.prompts[0].tools).toEqual(["get_canvas"]);
		expect(JSON.stringify(r.prompts[0].messages)).toContain("Plan mode");
	});

	it("does not count the approval wait against the tool or model timeout", async () => {
		const slow = async (): Promise<Approval> => {
			await Bun.sleep(400);
			return { ok: true };
		};
		const r = await run([["save_route", "call_route"]], "manual", slow, { slowTool: 50 });
		expect(r.ran.sort()).toEqual(["call_route", "save_route"]);
		expect(r.shown).not.toContain("timed out");
		expect(r.shown).not.toContain("[error]");
		expect(r.shown).toMatch(/← save_route 0\.\ds/);
	});

	it("stopping during a prompt rejects the call and ends the run", async () => {
		const ctrl = new AbortController();
		const never = () => {
			setTimeout(() => ctrl.abort(new Error("Stopped by user")), 20);
			return new Promise<Approval>(() => {});
		};
		const r = await run([["save_route"]], "manual", never, { signal: ctrl.signal });
		expect(r.ran).toEqual([]);
		expect(r.prompts).toHaveLength(1);
		expect(r.shown).toContain("[stopped]");
	});
});

describe("cli answers", () => {
	it("reads /mode", () => {
		expect(parseLine("/mode auto")).toEqual({ mode: "auto" });
		expect(parseLine("/mode")).toEqual({ mode: undefined });
		expect(parseLine("/mode fast")).toEqual({ mode: "fast" });
		expect(parseLine("/exit")).toBe("exit");
	});

	it("reads an approval answer", () => {
		expect(parseApproval("y", false)).toEqual({ ok: true });
		expect(parseApproval(" A ", false)).toEqual({ ok: true, always: true });
		expect(parseApproval("a", true)).toBeUndefined();
		expect(parseApproval("n", false)).toEqual({ ok: false });
		expect(parseApproval("use /v2 instead", false)).toEqual({ ok: false, reason: "use /v2 instead" });
		expect(parseApproval("", false)).toBeUndefined();
	});

	it("reads Start?", () => {
		expect(parseStart("y")).toBe("start");
		expect(parseStart("N")).toBe("stay");
		expect(parseStart("")).toBeUndefined();
		expect(parseStart("also add auth")).toEqual({ changes: "also add auth" });
	});

	it("shows edit_canvas ops readably", () => {
		const s = describeCall("edit_canvas", {
			target: { kind: "route", id: "r1" },
			version: 3,
			ops: [
				{ op: "add_block", ref: "a", type: "response", data: { status: 200 } },
				{ op: "connect", from: "entry", to: "a" },
				{ op: "remove_block", id: "b2" },
			],
		});
		expect(s).toContain("edit_canvas route r1 (v3)");
		expect(s).toContain("• add_block response a");
		expect(s).toContain("• connect entry → a");
		expect(s).toContain("• remove_block b2");
	});
});

describe("cli approver", () => {
	const call = (toolName: string, isDelete = false) => ({ toolCallId: "c", toolName, input: {}, isDelete });
	const setup = (answers: (string | null)[]) => {
		const prompts: string[] = [];
		const events: string[] = [];
		let shown = "";
		const approve = cliApprover(
			async (p) => {
				prompts.push(p);
				return answers.shift() ?? null;
			},
			(s) => (shown += s),
			(e) => events.push(e),
		);
		return { approve, prompts, events, shown: () => shown };
	};

	it("shows the call, offers a, and logs the wait", async () => {
		const s = setup(["", "a"]);
		expect(await s.approve(call("save_route"))).toEqual({ ok: true, always: true });
		expect(s.shown()).toContain("Approve save_route {}");
		expect(s.prompts).toEqual(["[y/n/a/reason] ", "[y/n/a/reason] "]);
		expect(s.events).toEqual(["approval-request", "approval-result"]);
	});

	it("does not offer a for a delete", async () => {
		const s = setup(["a", "y"]);
		expect(await s.approve(call("delete_route", true))).toEqual({ ok: true });
		expect(s.shown()).toContain("Delete delete_route");
		expect(s.prompts).toEqual(["[y/n/reason] ", "[y/n/reason] "]);
	});

	it("Ctrl+C at the prompt rejects", async () => {
		const s = setup([null]);
		expect(await s.approve(call("save_route"))).toEqual({ ok: false, reason: "stopped by the user" });
	});
});

describe("plan then start", () => {
	const setup = (answers: NonNullable<ReturnType<typeof parseStart>>[]) => {
		const session = {
			history: [],
			mode: "plan" as Mode,
			allowed: new Set<string>(),
			loaded: new Set<string>(),
		};
		const runs: [string, Mode][] = [];
		const runOne = async (p: string) => {
			runs.push([p, session.mode]);
			return false;
		};
		let shown = "";
		const go = () => converse(session, "add /health", runOne, async () => answers.shift() ?? "stay", (s) => (shown += s));
		return { session, runs, go, shown: () => shown };
	};

	it("y runs the plan in auto and the session stays in auto", async () => {
		const s = setup(["start"]);
		await s.go();
		expect(s.runs).toEqual([
			["add /health", "plan"],
			["Go ahead with the plan.", "auto"],
		]);
		expect(s.session.mode).toBe("auto");
		expect(s.shown()).toContain("Mode: auto");
	});

	it("changes go back in plan mode and it asks again", async () => {
		const s = setup([{ changes: "also add auth" }, "stay"]);
		await s.go();
		expect(s.runs).toEqual([
			["add /health", "plan"],
			["also add auth", "plan"],
		]);
		expect(s.session.mode).toBe("plan");
	});

	it("n stays in plan without running", async () => {
		const s = setup(["stay"]);
		await s.go();
		expect(s.runs).toHaveLength(1);
		expect(s.session.mode).toBe("plan");
	});
});
