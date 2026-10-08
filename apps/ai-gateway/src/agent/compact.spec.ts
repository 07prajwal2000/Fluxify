import { describe, expect, it } from "bun:test";
import { type ModelMessage, tool } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { approveAll, assertEndsOnUserOrTool, runAgent } from "./agent";
import { compactNow } from "./cli";
import { SUMMARY_HEAD, trimOld } from "./compact";
import { printRun } from "./progress";

const BIG = "x".repeat(2000);
const usage = (input: number) => ({
	inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
});
const finish = (reason: string, input: number) => ({
	type: "finish",
	finishReason: { unified: reason, raw: reason },
	usage: usage(input),
});
const text = (s: string) => [
	{ type: "text-start", id: "t" },
	{ type: "text-delta", id: "t", delta: s },
	{ type: "text-end", id: "t" },
];

/** One finished step: a call and its result. */
const step = (i: number, name = "get_route", out = BIG): ModelMessage[] => [
	{
		role: "assistant",
		content: [{ type: "tool-call", toolCallId: `h${i}`, toolName: name, input: {} }],
	},
	{
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: `h${i}`,
				toolName: name,
				output: { type: "text", value: out },
			},
		],
	},
];
const results = (ms: ModelMessage[]) =>
	ms.flatMap((m) =>
		m.role === "tool"
			? m.content.flatMap((p) =>
					p.type === "tool-result" ? [(p.output as { value: string }).value] : [],
				)
			: [],
	);

/**
 * A run where the model calls get_route `calls` times then answers. Each step
 * reports `input` tokens. `summary` is what the summary call returns (throw to fail).
 */
async function run(
	history: ModelMessage[],
	o: { calls: number; input: number; context: number; summary?: () => string },
) {
	const prompts: ModelMessage[][] = [];
	const model = new MockLanguageModelV4({
		doGenerate: async () => ({
			content: [{ type: "text", text: (o.summary ?? (() => "the summary"))() }],
			finishReason: { unified: "stop", raw: "stop" },
			usage: usage(1),
			warnings: [],
		}),
		doStream: async (call) => {
			prompts.push(call.prompt as ModelMessage[]);
			const n = prompts.length;
			const parts =
				n > o.calls
					? [...text("done"), finish("stop", o.input)]
					: [
							{ type: "tool-call", toolCallId: `c${n}`, toolName: "get_route", input: "{}" },
							finish("tool-calls", o.input),
						];
			return { stream: convertArrayToReadableStream(parts as never[]) };
		},
	});
	const tools = {
		get_route: tool({ inputSchema: z.object({}).passthrough(), execute: async () => BIG }),
	};
	const result = runAgent({
		model,
		tools,
		active: () => ["get_route"],
		projectId: "p",
		history,
		limits: { idleMs: 1000, callMs: 1000, toolMs: 1000, retries: 0, maxContextTokens: o.context },
		mode: "auto",
		approve: approveAll,
	});
	let shown = "";
	const logged: object[] = [];
	await printRun(result, {
		write: (s) => (shown += s),
		log: (e, d) => e === "compaction" && logged.push(d ?? {}),
	});
	return { prompts, shown, logged };
}

const longChat = (): ModelMessage[] => [
	{ role: "user", content: "build a route" },
	...[1, 2, 3, 4, 5].flatMap((i) => step(i)),
	{ role: "assistant", content: "built it" },
	{ role: "user", content: "now test it" },
];

describe("60%: trim old tool results", () => {
	it("stubs old big results, keeps the last steps and the latest canvas, leaves the input alone", () => {
		const ms: ModelMessage[] = [
			{ role: "user", content: "go" },
			...step(1, "get_canvas"),
			...step(2),
			...step(3, "get_canvas"),
			...step(4),
			...step(5),
			...step(6),
		];
		const before = JSON.stringify(ms);
		const t = trimOld(ms);
		expect(JSON.stringify(ms)).toBe(before);
		expect(results(t.messages)).toEqual([
			"[result trimmed: get_canvas, 2026 chars]",
			"[result trimmed: get_route, 2026 chars]",
			BIG, // latest canvas
			BIG,
			BIG,
			BIG,
		]);
		expect(t.results).toBe(2);
		expect(JSON.stringify(trimOld(ms))).toBe(JSON.stringify(t)); // same input, same output
	});

	it("trims what is sent but not the history, and the CLI shows it", async () => {
		const history = longChat();
		const copy = structuredClone(history);
		// ~3.4k tokens of 5k: over 60%, under 80%
		const r = await run(history, { calls: 1, input: 3400, context: 5000 });
		expect(results(r.prompts[0]).filter((s) => s.startsWith("[result trimmed"))).toHaveLength(3);
		expect(history.slice(0, copy.length)).toEqual(copy);
		expect(r.shown).toContain("[compacted] trimmed 3 old tool results (−1k tokens)");
		expect(r.logged[0]).toMatchObject({ kind: "trim", results: 3 });
	});

	it("does nothing under 60%", async () => {
		const r = await run(longChat(), { calls: 0, input: 1, context: 100_000 });
		expect(results(r.prompts[0])).not.toContain("[result trimmed: get_route, 2026 chars]");
		expect(r.shown).not.toContain("[compacted]");
	});
});

describe("80%: summary", () => {
	it("swaps a summary into history, keeps the last user message, ends on user or tool", async () => {
		const history = longChat();
		const r = await run(history, { calls: 1, input: 100, context: 3000 });
		const sent = r.prompts[0].filter((m) => m.role !== "system");
		expect(JSON.stringify(sent[0])).toContain(JSON.stringify(`${SUMMARY_HEAD}the summary`));
		expect(JSON.stringify(sent[1])).toContain("now test it");
		expect(() => assertEndsOnUserOrTool(sent)).not.toThrow();
		expect(history[0]).toEqual({ role: "user", content: `${SUMMARY_HEAD}the summary` });
		expect(history[1]).toEqual({ role: "user", content: "now test it" });
		expect(r.shown).toMatch(/\[compacted\] summarized 12 messages: \S+ → \S+ tokens/);
		expect(r.logged[0]).toMatchObject({ kind: "summary", messages: 12, coversUpTo: 12 });
		// the cached prefix: same system prompt on every step
		const systems = r.prompts.map((p) => JSON.stringify(p.filter((m) => m.role === "system")));
		expect(new Set(systems).size).toBe(1);
	});

	it("falls back to the trim when the summary fails", async () => {
		const history = longChat();
		const r = await run(history, {
			calls: 0,
			input: 1,
			context: 3000,
			summary: () => {
				throw new Error("boom");
			},
		});
		expect(r.shown).toContain("[compacted] summary failed (boom)");
		expect(r.shown).toContain("[compacted] trimmed");
		expect(results(r.prompts[0])[0]).toStartWith("[result trimmed");
		expect(history[0]).toEqual({ role: "user", content: "build a route" });
	});

	it("/compact summarizes now and prints the stats", async () => {
		const history: ModelMessage[] = [...longChat(), { role: "assistant", content: "tested" }];
		const model = new MockLanguageModelV4({
			doGenerate: async () => ({
				content: [{ type: "text", text: "s" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage: usage(1),
				warnings: [],
			}),
		});
		let out = "";
		await compactNow(history, "sys", (s) => (out += s), () => {}, model);
		expect(out).toMatch(/^\[compacted\] summarized 12 messages: 3k → \d+ tokens\n$/);
		expect(history.map((m) => m.role)).toEqual(["user", "user", "assistant"]);
		expect(() => assertEndsOnUserOrTool([...history, { role: "user", content: "hi" }])).not.toThrow();
	});
});
