import { expect } from "bun:test";
import { type ModelMessage, tool } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { approveAll, assertEndsOnUserOrTool, type Limit, runAgent } from "./agent";
import { printRun } from "./progress";

/** Test harness for the guard specs: a fake model that makes the given calls, then says "done". */

const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const finish = (reason: string) => ({
	type: "finish",
	finishReason: { unified: reason, raw: reason },
	usage,
});
const reply = (parts: object[]) => ({ stream: convertArrayToReadableStream(parts as any) });
const done = () =>
	reply([
		{ type: "text-start", id: "t" },
		{ type: "text-delta", id: "t", delta: "done" },
		{ type: "text-end", id: "t" },
		finish("stop"),
	]);

/** An input for get_canvas (a read), or [tool, input]. */
export type Step = object | [string, object];
type Opts = {
	fail?: string;
	/** What a tool returns (throw to fail); "ok" by default. */
	respond?: (name: string, input: any) => unknown;
	onLimit?: (l: Limit) => boolean | Promise<boolean>;
	maxSteps?: number;
	tokenBudget?: number;
	signal?: AbortSignal;
};
const NAMES = ["get_canvas", "edit_canvas", "call_route", "save_route"];

/** Every step uses 2 tokens (1 in, 1 out). */
export async function run(calls: Step[], opts: Opts = {}) {
	const prompts: ModelMessage[][] = [];
	const limitsAsked: Limit[] = [];
	const model = new MockLanguageModelV4({
		doStream: async (o) => {
			prompts.push(o.prompt as ModelMessage[]);
			const step = calls[prompts.length - 1];
			if (!step) return done() as any;
			const [toolName, input] = Array.isArray(step) ? step : ["get_canvas", step];
			const call = {
				type: "tool-call",
				toolCallId: `c${prompts.length}`,
				toolName,
				input: JSON.stringify(input),
			};
			return reply([call, finish("tool-calls")]) as any;
		},
	});
	const tools = Object.fromEntries(
		NAMES.map((n) => [
			n,
			tool({
				inputSchema: z.object({}).passthrough(),
				execute: async (input) => {
					if (opts.fail) throw new Error(opts.fail);
					return opts.respond ? opts.respond(n, input) : "ok";
				},
			}),
		]),
	);
	const history: ModelMessage[] = [{ role: "user", content: "go" }];
	const { maxSteps, tokenBudget, onLimit } = opts;
	const result = runAgent({
		model,
		tools,
		active: () => NAMES,
		projectId: "p",
		history,
		limits: { idleMs: 1000, callMs: 1000, toolMs: 1000, retries: 0, maxSteps, tokenBudget },
		mode: "auto",
		approve: approveAll,
		abortSignal: opts.signal,
		onLimit: onLimit
			? async (l) => {
					limitsAsked.push(l);
					return onLimit(l);
				}
			: undefined,
	});
	let shown = "";
	await printRun(result, { write: (s) => (shown += s) });
	/** What each tool result said, in order. */
	const results = history.flatMap((m) =>
		m.role === "tool" ? m.content.map((p) => JSON.stringify(p)) : [],
	);
	return { prompts, history, shown, results, limitsAsked, stopped: result.stopped() };
}

export const nextRequestIsValid = (history: ModelMessage[]) => {
	expect(history.at(-1)?.role).toBe("assistant");
	const next: ModelMessage[] = [...history, { role: "user", content: "go on" }];
	expect(() => assertEndsOnUserOrTool(next)).not.toThrow();
};

/** Which tool results carried the looping nudge. */
export const looping = (r: { results: string[] }) =>
	r.results.map((s) => s.includes("You are looping"));

/** Reads with different args each step. */
export const distinct = (n: number) => Array.from({ length: n }, (_, i) => ({ q: `q${i}` }));
