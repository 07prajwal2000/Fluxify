import { describe, expect, it } from "bun:test";
import { APICallError, type ModelMessage, tool } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { assertEndsOnUserOrTool, MAX_STEPS, runAgent, STEP_LIMIT_NOTE } from "./agent";
import { onInterrupt, parseLine } from "./cli";
import { printRun } from "./progress";

const limits = { idleMs: 50, callMs: 300, toolMs: 50, retries: 5 };
const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const finish = (reason: "stop" | "tool-calls") => ({
	type: "finish",
	finishReason: { unified: reason, raw: reason },
	usage,
});
const text = (s: string) => [
	{ type: "text-start", id: "t" },
	{ type: "text-delta", id: "t", delta: s },
	{ type: "text-end", id: "t" },
];
const reply = (parts: object[]) => ({ stream: convertArrayToReadableStream(parts as any) });
/** Sends stream-start, then nothing ever again. */
const hang = () => ({ stream: new ReadableStream({ start: (c) => c.enqueue({ type: "stream-start", warnings: [] }) }) });

/** Runs `answers` in order (one per model call) and returns what the terminal showed. */
async function run(
	answers: (() => object)[],
	opts: { tools?: any; signal?: AbortSignal; history?: ModelMessage[] } = {},
) {
	const prompts: ModelMessage[][] = [];
	const model = new MockLanguageModelV4({
		doStream: async (o) => {
			prompts.push(o.prompt as ModelMessage[]);
			return answers[prompts.length - 1]() as any;
		},
	});
	const retries: string[] = [];
	const history: ModelMessage[] = opts.history ?? [{ role: "user", content: "hi" }];
	const tools = opts.tools ?? {};
	const result = runAgent({
		model,
		tools,
		active: () => Object.keys(tools),
		projectId: "p",
		history,
		limits,
		abortSignal: opts.signal,
		onRetry: (why) => retries.push(why),
	});
	let shown = "";
	await printRun(result, { write: (s) => (shown += s) });
	return { shown, retries, prompts, history };
}

describe("model timeouts", () => {
	it("retries a model call that sends nothing, once, then shows a readable error", async () => {
		const { shown, retries, prompts } = await run([hang, hang]);
		expect(prompts).toHaveLength(2);
		expect(retries).toEqual(["The model sent nothing for 0s. Retrying once."]);
		expect(shown).toContain("[error] The model sent nothing for 0s. (after one retry)");
	});

	it("goes on with the retry's answer when it comes", async () => {
		const { shown, retries } = await run([hang, () => reply([...text("ok"), finish("stop")])]);
		expect(retries).toHaveLength(1);
		expect(shown).toContain("ok");
		expect(shown).not.toContain("[error]");
	});

	it("also counts a request that never answers as sending nothing", async () => {
		const { retries, shown } = await run([() => new Promise(() => {}), () => reply([...text("ok"), finish("stop")])]);
		expect(retries).toHaveLength(1);
		expect(shown).toContain("ok");
	});

	it("caps a call that keeps trickling, without a retry", async () => {
		const trickle = () => ({
			stream: new ReadableStream({
				async start(c) {
					c.enqueue({ type: "text-start", id: "t" });
					for (let i = 0; i < 100; i++) {
						c.enqueue({ type: "text-delta", id: "t", delta: "." });
						await Bun.sleep(20);
					}
				},
			}),
		});
		const { shown, retries, prompts } = await run([trickle]);
		expect(prompts).toHaveLength(1);
		expect(retries).toEqual([]);
		expect(shown).toContain("[error] The model call passed the 0s cap (AGENT_MODEL_TIMEOUT_MS).");
	});

	it("stops on the user's abort without retrying", async () => {
		const ctrl = new AbortController();
		setTimeout(() => ctrl.abort(), 20);
		const { shown, retries } = await run([hang, hang], { signal: ctrl.signal });
		expect(retries).toEqual([]);
		expect(shown).toContain("[stopped]");
	});
});

/** A provider error; retry-after-ms keeps the SDK's backoff short. */
const failWith = (statusCode: number, message: string, wait = "1") => () => {
	throw new APICallError({
		message,
		url: "http://model",
		requestBodyValues: {},
		statusCode,
		responseHeaders: { "retry-after-ms": wait },
	});
};

describe("provider errors", () => {
	it("retries a 429 with backoff and goes on with the answer", async () => {
		const ok = () => reply([...text("ok"), finish("stop")]);
		const { shown, retries, prompts } = await run([failWith(429, "Too Many Requests"), ok]);
		expect(prompts).toHaveLength(2);
		expect(retries).toEqual(["The model returned 429 Too Many Requests. Retrying (1/5)."]);
		expect(shown).toContain("ok");
		expect(shown).not.toContain("[error]");
	});

	it("does not retry a 400 and shows its message", async () => {
		const { shown, retries, prompts } = await run([failWith(400, "Bad Request")]);
		expect(prompts).toHaveLength(1);
		expect(retries).toEqual([]);
		expect(shown).toContain("[error] Bad Request");
	});

	it("stops on the user's abort during the backoff", async () => {
		const ctrl = new AbortController();
		setTimeout(() => ctrl.abort(), 20);
		const started = Date.now();
		const fail = failWith(429, "Too Many Requests", "5000");
		const { shown, prompts } = await run([fail, fail], { signal: ctrl.signal });
		expect(Date.now() - started).toBeLessThan(1000);
		expect(prompts).toHaveLength(1);
		expect(shown).toContain("[stopped]");
	});
});

describe("tool timeouts", () => {
	it("fails a stuck tool and tells the model", async () => {
		const tools = {
			slow: tool({ inputSchema: z.object({}), execute: () => new Promise(() => {}) }),
		};
		const call = { type: "tool-call", toolCallId: "c1", toolName: "slow", input: "{}" };
		const { shown, prompts, history } = await run(
			[() => reply([call, finish("tool-calls")]), () => reply([...text("sorry"), finish("stop")])],
			{ tools },
		);
		expect(shown).toContain("✗ slow");
		expect(JSON.stringify(prompts[1].at(-1))).toContain("slow timed out after 0s");
		expect(history.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
	});
});

describe("why a run ended early", () => {
	const lastText = (m: ModelMessage | undefined) => JSON.stringify(m?.content);

	it("notes a timed-out reply in history, and the next request still ends on the user", async () => {
		const first = await run([hang, hang]);
		const { history } = first;
		expect(history.at(-1)?.role).toBe("assistant");
		expect(lastText(history.at(-1))).toContain("(previous reply failed: The model sent nothing");
		history.push({ role: "user", content: "try again" });
		const { prompts } = await run([() => reply([...text("ok"), finish("stop")])], { history });
		expect(prompts[0].at(-1)?.role).toBe("user");
		expect(lastText(prompts[0].at(-2))).toContain("previous reply failed");
	});

	it("notes the step limit, says so in the terminal, and keeps the next request valid", async () => {
		const tools = { noop: tool({ inputSchema: z.object({}), execute: async () => "ok" }) };
		const call = () => reply([{ type: "tool-call", toolCallId: "c", toolName: "noop", input: "{}" }, finish("tool-calls")]);
		const { shown, prompts, history } = await run(Array(MAX_STEPS).fill(call), { tools });
		expect(prompts).toHaveLength(MAX_STEPS);
		expect(shown).toContain(`[stopped] reached ${MAX_STEPS}-step limit`);
		expect(history.at(-1)).toEqual({ role: "assistant", content: STEP_LIMIT_NOTE });
		history.push({ role: "user", content: "go on" });
		expect(() => assertEndsOnUserOrTool(history)).not.toThrow();
		expect(history.at(-3)?.role).toBe("tool");
	});
});

describe("cli input", () => {
	it("reads /exit, unknown commands, blank lines and messages", () => {
		expect(parseLine(" /exit ")).toBe("exit");
		expect(parseLine("/help")).toBe("unknown");
		expect(parseLine("   ")).toBe("skip");
		expect(parseLine("build a route")).toBe("run");
	});

	it("Ctrl+C stops a run, clears a line, and quits on the second press at an empty prompt", () => {
		expect(onInterrupt({ running: true, line: "", armed: false })).toBe("stop");
		expect(onInterrupt({ running: false, line: "abc", armed: true })).toBe("clear");
		expect(onInterrupt({ running: false, line: "", armed: false })).toBe("arm");
		expect(onInterrupt({ running: false, line: "", armed: true })).toBe("quit");
	});
});
