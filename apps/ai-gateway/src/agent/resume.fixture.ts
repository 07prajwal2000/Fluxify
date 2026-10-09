// Shared by resume.spec.ts and store.test.ts: a scripted model and the agent around it.
import { type ModelMessage, type Tool, tool } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import type { Approve } from "./agent";
import { withoutBudget } from "./budget.fixture";

const usage = (input: number) => ({
	inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
});
const finish = (reason: string) => ({
	type: "finish",
	finishReason: { unified: reason, raw: reason },
	usage: usage(1),
});
const text = (s: string) => [
	{ type: "text-start", id: "t" },
	{ type: "text-delta", id: "t", delta: s },
	{ type: "text-end", id: "t" },
];

export const BIG = "x".repeat(2000);
export const defer: Approve = async () => ({ ok: false, defer: true });

/**
 * A model that plays `script` across turns: each entry is the tools called in
 * that step; past the end, or on an empty entry, it answers "done". Summary
 * calls answer "the summary". `prompts` is what each step saw, `ran` what tools ran.
 */
export function scripted(script: string[][], approve: Approve = defer, maxContextTokens?: number) {
	const prompts: ModelMessage[][] = [];
	const ran: string[] = [];
	const model = new MockLanguageModelV4({
		doGenerate: async () => ({
			content: [{ type: "text", text: "the summary" }],
			finishReason: { unified: "stop", raw: "stop" },
			usage: usage(1),
			warnings: [],
		}),
		doStream: async (call) => {
			prompts.push(withoutBudget(call.prompt as ModelMessage[]));
			const names = script[prompts.length - 1] ?? [];
			const parts = names.length
				? [
						...names.map((n, i) => ({
							type: "tool-call",
							toolCallId: `c${prompts.length}-${i}`,
							toolName: n,
							input: "{}",
						})),
						finish("tool-calls"),
					]
				: [...text("done"), finish("stop")];
			return { stream: convertArrayToReadableStream(parts as never[]) };
		},
	});
	const tools = Object.fromEntries(
		["save_route", "get_route"].map((n) => [
			n,
			tool({
				inputSchema: z.object({}).passthrough(),
				execute: async () => {
					ran.push(n);
					return n === "get_route" ? BIG : "ok";
				},
			}),
		]),
	);
	const agent = {
		model,
		tools,
		active: () => Object.keys(tools),
		projectId: "p",
		limits: { idleMs: 1000, callMs: 1000, toolMs: 1000, retries: 0, maxContextTokens },
		mode: "manual" as const,
		approve,
	};
	return { agent, prompts, ran };
}

/** A finished get_route step: the call and its (big) result. */
export const step = (i: number): ModelMessage[] => [
	{
		role: "assistant",
		content: [{ type: "tool-call", toolCallId: `h${i}`, toolName: "get_route", input: {} }],
	},
	{
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: `h${i}`,
				toolName: "get_route",
				output: { type: "text", value: BIG },
			},
		],
	},
];

/** As stored and read back: plain JSON. */
export const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** A finished step that edited route r1's canvas. */
export const editStep = (i: number): ModelMessage[] => [
	{
		role: "assistant",
		content: [
			{
				type: "tool-call",
				toolCallId: `e${i}`,
				toolName: "edit_canvas",
				input: { target: { kind: "route", id: "r1" }, version: i, ops: [] },
			},
		],
	},
	{
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: `e${i}`,
				toolName: "edit_canvas",
				output: { type: "json", value: { version: i + 1 } },
			},
		],
	},
];

/** The agent plus a get_canvas that answers a one-block canvas: what a summary re-attaches. */
export const withCanvas = <A extends { tools: Record<string, Tool> }>(agent: A): A => ({
	...agent,
	tools: {
		...agent.tools,
		get_canvas: tool({
			inputSchema: z.object({}).passthrough(),
			execute: async () => ({
				version: 9,
				blocks: [{ key: "kv_set_9", type: "kv_set" }],
				edges: [],
			}),
		}),
	},
});
