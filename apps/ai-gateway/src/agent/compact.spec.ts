import { describe, expect, it } from "bun:test";
import { type ModelMessage, tool } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { approveAll, assertEndsOnUserOrTool, runAgent } from "./agent";
import { withoutBudget } from "./budget.fixture";
import { compactNow, parseLine } from "./cli";
import { canCompact, SUMMARY_HEAD, summarize, trimOld } from "./compact";
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
	o: { calls: number; input: number | number[]; context: number; summary?: () => string },
) {
	const prompts: ModelMessage[][] = [];
	const input = (n: number) => (typeof o.input === "number" ? o.input : (o.input[n - 1] ?? o.input.at(-1)!));
	const model = new MockLanguageModelV4({
		doGenerate: async () => ({
			content: [{ type: "text", text: (o.summary ?? (() => "the summary"))() }],
			finishReason: { unified: "stop", raw: "stop" },
			usage: usage(1),
			warnings: [],
		}),
		doStream: async (call) => {
			prompts.push(withoutBudget(call.prompt as ModelMessage[]));
			const n = prompts.length;
			const parts =
				n > o.calls
					? [...text("done"), finish("stop", input(n))]
					: [
							{ type: "tool-call", toolCallId: `c${n}`, toolName: "get_route", input: "{}" },
							finish("tool-calls", input(n)),
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
		// the cut-off is the start of the last 3 steps; h3 is the latest canvas
		const t = trimOld(ms, 7, { keep: new Set(["h3"]) });
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
		expect(JSON.stringify(trimOld(ms, 7, { keep: new Set(["h3"]) }))).toBe(JSON.stringify(t)); // same input, same output
	});

	it("trims what is sent but not the history, and the CLI shows it", async () => {
		const history = longChat();
		const copy = structuredClone(history);
		// ~3.4k tokens of 5k: over 60%, under 80%
		const r = await run(history, { calls: 1, input: 3400, context: 5000 });
		expect(results(r.prompts[0]).filter((s) => s.startsWith("[result trimmed"))).toHaveLength(3);
		expect(history.slice(0, copy.length)).toEqual(copy);
		// the first figure rounds with the size of the system prompt
		expect(r.shown).toMatch(/\[compacted\] Trimmed 3 old tool results \(get_route ×3\), \dk → 2k tokens/);
		expect(r.logged[0]).toMatchObject({ kind: "trim", results: 3, tools: { get_route: 3 } });
	});

	it("keeps the trimmed prefix identical between batches and moves it only on a new crossing", async () => {
		// 3000 of 5000 = 60%: over, then under at step 2, over again at step 3
		const r = await run(longChat(), { calls: 4, input: [3000, 100, 3000, 3000], context: 5000 });
		const head = (i: number) => JSON.stringify(r.prompts[i].slice(0, 12));
		const trimmed = (i: number) =>
			results(r.prompts[i]).filter((s) => s.startsWith("[result trimmed")).length;
		// batch 1 before step 1, then frozen while the history grows
		expect(trimmed(0)).toBe(3);
		expect(head(1)).toBe(head(0));
		expect(head(2)).toBe(head(0)); // under 60% now: armed, but nothing moves
		// back over 60%: batch 2 moves the cut-off, then it is frozen again
		expect(trimmed(3)).toBeGreaterThan(3);
		expect(head(4)).toBe(head(3));
		// one line per batch
		expect(r.shown.match(/\[compacted\] Trimmed/g)).toHaveLength(2);
		expect(r.logged).toHaveLength(2);
	});

	it("does not trim again while usage stays over 60% (the summary is the backstop)", async () => {
		const r = await run(longChat(), { calls: 3, input: 3400, context: 5000 });
		expect(r.shown.match(/\[compacted\] Trimmed/g)).toHaveLength(1);
		expect(JSON.stringify(r.prompts[3].slice(0, 12))).toBe(JSON.stringify(r.prompts[0].slice(0, 12)));
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
		expect(r.shown).toMatch(/\[compacted\] Summarized 12 messages, \S+ → \S+ tokens/);
		expect(r.logged[0]).toMatchObject({ kind: "summary", messages: 12, coversUpTo: 12 });
		// the cached prefix: same system prompt on every step
		const systems = r.prompts.map((p) => JSON.stringify(p.filter((m) => m.role === "system")));
		expect(new Set(systems).size).toBe(1);
		// the history is small after the summary, so nothing else is trimmed
		expect(r.shown).not.toContain("Trimmed");
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
		expect(r.shown).toContain("[compacted] Trimmed");
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
		expect(out).toMatch(/^Compacting…\n\[compacted\] Summarized 12 messages, 3k → \d+ tokens\n$/);
		expect(history.map((m) => m.role)).toEqual(["user", "user", "assistant"]);
		expect(() => assertEndsOnUserOrTool([...history, { role: "user", content: "hi" }])).not.toThrow();
	});
});

describe("/compact [what to keep]", () => {
	/** A model that answers "s" and records the summary prompt it was given. */
	const recorder = () => {
		const prompts: string[] = [];
		const model = new MockLanguageModelV4({
			doGenerate: async (call) => {
				prompts.push(JSON.stringify(call.prompt));
				return {
					content: [{ type: "text", text: "s" }],
					finishReason: { unified: "stop", raw: "stop" },
					usage: usage(1),
					warnings: [],
				};
			},
		});
		return { model, prompts };
	};
	const chat = (): ModelMessage[] => [...longChat(), { role: "assistant", content: "tested" }];

	it("the text reaches the summary prompt; without it the prompt is unchanged", async () => {
		const a = recorder();
		await summarize(a.model, chat(), { keep: "  the users table schema and the route ids " });
		expect(a.prompts[0]).toContain("The user asks you to keep: the users table schema and the route ids");
		const b = recorder();
		await summarize(b.model, chat(), { keep: "   " });
		await summarize(b.model, chat());
		expect(b.prompts.join()).not.toContain("The user asks you to keep");
	});

	it("canCompact says whether a summary would cover anything", () => {
		expect(canCompact(chat())).toBe(true);
		expect(canCompact([{ role: "user", content: "hi" }])).toBe(false);
		expect(canCompact([])).toBe(false);
	});

	it("the terminal passes the text on", async () => {
		const { model, prompts } = recorder();
		await compactNow(chat(), "sys", () => {}, () => {}, model, "keep the ids");
		expect(prompts[0]).toContain("The user asks you to keep: keep the ids");
	});

	it("parses /compact with and without text", () => {
		expect(parseLine("/compact")).toBe("compact");
		expect(parseLine("  /compact  ")).toBe("compact");
		expect(parseLine("/compact keep the route ids")).toEqual({ compact: "keep the route ids" });
		expect(parseLine("/compactx")).toBe("unknown");
		expect(parseLine("/mode plan")).toEqual({ mode: "plan" });
	});
});
