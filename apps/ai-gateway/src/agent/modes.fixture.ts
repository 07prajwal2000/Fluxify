import { type ModelMessage, tool } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { type Approval, type PendingCall, runAgent } from "./agent";
import { withoutBudget } from "./budget.fixture";
import { printRun } from "./progress";
import type { Mode } from "./tools";

/** The harness the mode specs share: one scripted run, returning what was asked, what ran and what the model saw. */
export const limits = { idleMs: 1000, callMs: 300, toolMs: 100, retries: 0 };
export const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
};
export const reply = (parts: object[], reason: "stop" | "tool-calls") => ({
	stream: convertArrayToReadableStream([
		...parts,
		{ type: "finish", finishReason: { unified: reason, raw: reason }, usage },
	] as any),
});
export const text = (s: string) => [
	{ type: "text-start", id: "t" },
	{ type: "text-delta", id: "t", delta: s },
	{ type: "text-end", id: "t" },
];
export const NAMES = [
	"save_route",
	"call_route",
	"get_canvas",
	"delete_route",
	"run_test_suite",
	"run_blocks",
	"copy_blocks",
	"get_system_logs",
	"save_app_config",
	"save_integration",
	"save_trigger",
	"promote_version",
	"rollback_version",
	"get",
];

/**
 * One run: each entry of `steps` is the tools the model calls in that step,
 * then it answers "done". Returns what was asked, what ran, and what the model saw.
 */
export async function run(
	steps: string[][],
	mode: Mode,
	answer: (c: PendingCall) => Approval | Promise<Approval> = () => ({ ok: true }),
	opts: {
		allowed?: Set<string>;
		signal?: AbortSignal;
		slowTool?: number;
		askBeforeEphemeralRuns?: boolean;
		askBeforeProductionReads?: boolean;
		askBeforeProductionWrites?: boolean;
	} = {},
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
			prompts.push({
				tools: (o.tools ?? []).map((t) => t.name),
				messages: withoutBudget(o.prompt as ModelMessage[]),
			});
			const names = steps[prompts.length - 1];
			if (!names) return reply(text("done"), "stop") as any;
			// "name|{json}" gives the call arguments
			const calls = names.map((n, i) => ({
				type: "tool-call",
				toolCallId: `c${prompts.length}-${i}`,
				toolName: n.split("|")[0],
				input: n.split("|")[1] ?? "{}",
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
		askBeforeEphemeralRuns: opts.askBeforeEphemeralRuns,
		askBeforeProductionReads: opts.askBeforeProductionReads,
		askBeforeProductionWrites: opts.askBeforeProductionWrites,
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
