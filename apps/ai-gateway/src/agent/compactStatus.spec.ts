import { describe, expect, it } from "bun:test";
import { type ModelMessage, tool } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { approveAll, runAgent } from "./agent";
import { budgetLine } from "./guards";
import { printRun } from "./progress";
import { type AgentEvent, pump } from "./runner/events";

const usage = (input: number) => ({
	inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
});
const finish = (reason: string, input: number) => ({
	type: "finish",
	finishReason: { unified: reason, raw: reason },
	usage: usage(input),
});
const BIG = "x".repeat(2000);
const step = (i: number): ModelMessage[] => [
	{ role: "assistant", content: [{ type: "tool-call", toolCallId: `h${i}`, toolName: "get_route", input: {} }] },
	{
		role: "tool",
		content: [{ type: "tool-result", toolCallId: `h${i}`, toolName: "get_route", output: { type: "text", value: BIG } }],
	},
];
const longChat = (): ModelMessage[] => [
	{ role: "user", content: "build a route" },
	...[1, 2, 3, 4, 5].flatMap(step),
	{ role: "assistant", content: "built it" },
	{ role: "user", content: "now test it" },
];

/** A run of `calls` get_route steps over a long chat; the summary call fails when `fail` is set. */
function start(o: { context: number; input: number; calls?: number; fail?: boolean }) {
	const requests: ModelMessage[][] = [];
	const model = new MockLanguageModelV4({
		doGenerate: async () => {
			if (o.fail) throw new Error("boom");
			return {
				content: [{ type: "text", text: "the summary" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage: usage(1),
				warnings: [],
			};
		},
		doStream: async (call) => {
			requests.push(call.prompt as ModelMessage[]);
			const n = requests.length;
			const parts =
				n > (o.calls ?? 0)
					? [
							{ type: "text-start", id: "t" },
							{ type: "text-delta", id: "t", delta: "done" },
							{ type: "text-end", id: "t" },
							finish("stop", o.input),
						]
					: [{ type: "tool-call", toolCallId: `c${n}`, toolName: "get_route", input: "{}" }, finish("tool-calls", o.input)];
			return { stream: convertArrayToReadableStream(parts as never[]) };
		},
	});
	const history = longChat();
	const result = runAgent({
		model,
		tools: { get_route: tool({ inputSchema: z.object({}).passthrough(), execute: async () => BIG }) },
		active: () => ["get_route"],
		projectId: "p",
		history,
		limits: { idleMs: 1000, callMs: 1000, toolMs: 1000, retries: 0, maxContextTokens: o.context },
		mode: "auto",
		approve: approveAll,
	});
	return { result, requests, history };
}

describe("Compacting… while a summary is written", () => {
	it("the stream says on, then off, then the finished line (web events)", async () => {
		const { result } = start({ context: 3000, input: 100 });
		const t = { next: 12, step: 12 };
		const events: AgentEvent[] = [];
		await pump(result, t, (e) => events.push(e));
		const kinds = events.map((e) => (e.type === "compacting" ? `compacting ${e.on}` : e.type));
		expect(kinds.slice(0, 3)).toEqual(["compacting true", "compacting false", "compaction"]);
		const done = events[2] as Extract<AgentEvent, { type: "compaction" }>;
		expect(done.compaction).toMatchObject({ kind: "summary", messages: 12 });
	});

	it("also goes off when the summary fails", async () => {
		const { result } = start({ context: 3000, input: 100, fail: true });
		const events: AgentEvent[] = [];
		await pump(result, { next: 12, step: 12 }, (e) => events.push(e));
		expect(events.filter((e) => e.type === "compacting").map((e) => (e as { on: boolean }).on)).toEqual([
			true,
			false,
		]);
	});

	it("a trim alone is instant: no status", async () => {
		const { result } = start({ context: 5000, input: 3400 });
		const events: AgentEvent[] = [];
		await pump(result, { next: 12, step: 12 }, (e) => events.push(e));
		expect(events.some((e) => e.type === "compacting")).toBe(false);
		expect(events.some((e) => e.type === "compaction")).toBe(true);
	});

	it("the terminal shows compacting… instead of waiting for model…", async () => {
		const { result } = start({ context: 3000, input: 100 });
		let shown = "";
		await printRun(result, { write: (s) => (shown += s), tty: true });
		// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal codes
		const plain = shown.replace(/\x1b\[[0-9;]*[A-Za-z]|\r/g, "");
		expect(plain).toContain("compacting… 0s");
		expect(plain.indexOf("compacting…")).toBeLessThan(plain.indexOf("[compacted] Summarized"));
		expect(plain.indexOf("compacting…")).toBeGreaterThan(plain.indexOf("waiting for model…"));
	});
});

describe("the budget line", () => {
	it("reads like the example, in k and M", () => {
		expect(budgetLine(23, 40, 610_000, 1_000_000)).toBe("Budget: step 23/40, 610k/1M tokens used");
		expect(budgetLine(1, 40, 0, 1_500_000)).toBe("Budget: step 1/40, 0/1.5M tokens used");
	});

	it("is the last message of every request, counts steps and tokens, and is never stored", async () => {
		const { result, requests, history } = start({ context: 100_000, input: 100, calls: 2 });
		await result.consumeStream();
		const lasts = requests.map((r) => JSON.stringify(r.at(-1)));
		expect(lasts[0]).toContain("Budget: step 1/40, 0/1M tokens used");
		expect(lasts[1]).toContain("Budget: step 2/40, 101/1M tokens used");
		expect(lasts[2]).toContain("Budget: step 3/40, 202/1M tokens used");
		expect(requests[0].at(-1)?.role).toBe("user");
		expect(JSON.stringify(history)).not.toContain("Budget:");
		// the rest of the request is the history alone, so the prefix does not move with the line
		const prefix = (i: number) => JSON.stringify(requests[i].slice(0, -1).slice(0, requests[0].length - 1));
		expect(prefix(1)).toBe(prefix(0));
	});
});
