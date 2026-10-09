import { describe, expect, it } from "bun:test";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { runAgent } from "./agent";
import { effortFromEnv, type Effort, type Provider, supportsThinking, thinkingOptions } from "./model";

describe("supportsThinking", () => {
	it.each([
		["anthropic", "claude-3-7-sonnet-20250219", true],
		["anthropic", "claude-sonnet-4-5", true],
		["anthropic", "claude-opus-4-1-20250805", true],
		["anthropic", "claude-opus-5-5", true],
		["anthropic", "claude-4-opus", true],
		["anthropic", "claude-3-5-sonnet-20241022", false],
		["anthropic", "claude-3-haiku-20240307", false],
		["openai", "o1", true],
		["openai", "o3-mini", true],
		["openai", "o4-mini", true],
		["openai", "gpt-5", true],
		["openai", "gpt-5.2", true],
		["openai", "gpt-5-chat-latest", false],
		["openai", "gpt-4.1", false],
		["openai", "gpt-4o", false],
		["google", "gemini-2.5-flash", true],
		["google", "gemini-3-pro-preview", true],
		["google", "gemini-2.0-flash", false],
		["mistral", "magistral-medium-latest", true],
		["mistral", "mistral-large-latest", false],
		["openai-compatible", "o3", false],
		["openai-compatible", "deepseek-reasoner", false],
	] as [Provider, string, boolean][])("%s %s: %p", (provider, id, expected) => {
		expect(supportsThinking(provider, id)).toBe(expected);
	});
});

describe("thinkingOptions", () => {
	const at = (p: Provider, id: string) => (e: Effort) => thinkingOptions(p, id, e);

	it("anthropic: thinking off, or a budget of 2000 / 8000 / 24000 tokens", () => {
		const o = at("anthropic", "claude-sonnet-4-5");
		expect(o("none")).toEqual({ anthropic: { thinking: { type: "disabled" } } });
		expect(o("low")).toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 2000 } } });
		expect(o("mid")).toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 8000 } } });
		expect(o("high")).toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 24000 } } });
	});

	it("openai: none is the lowest effort the model allows", () => {
		const effort = (id: string, e: Effort) => (thinkingOptions("openai", id, e) as any).openai.reasoningEffort;
		expect(effort("o3", "none")).toBe("low");
		expect(effort("gpt-5", "none")).toBe("minimal");
		expect(effort("gpt-5-mini", "none")).toBe("minimal");
		expect(effort("gpt-5.1", "none")).toBe("none");
		expect(effort("gpt-5.5", "none")).toBe("none");
		expect(["low", "mid", "high"].map((e) => effort("gpt-5", e as Effort))).toEqual([
			"low",
			"medium",
			"high",
		]);
	});

	it("google: thinkingBudget 0 / 2000 / 8000 / 24000, 2.5 pro never below 128", () => {
		const budget = (id: string, e: Effort) =>
			(thinkingOptions("google", id, e) as any).google.thinkingConfig.thinkingBudget;
		expect((["none", "low", "mid", "high"] as Effort[]).map((e) => budget("gemini-2.5-flash", e))).toEqual([
			0, 2000, 8000, 24000,
		]);
		expect(budget("gemini-2.5-pro", "none")).toBe(128);
		expect(budget("gemini-2.5-pro", "low")).toBe(2000);
	});

	it("mistral: reasoningEffort none or high", () => {
		const o = at("mistral", "magistral-medium-latest");
		expect(o("none")).toEqual({ mistral: { reasoningEffort: "none" } });
		expect(o("mid")).toEqual({ mistral: { reasoningEffort: "high" } });
	});

	it("sends nothing for a model not known to think", () => {
		expect(thinkingOptions("openai-compatible", "o3", "high")).toBeUndefined();
		expect(thinkingOptions("openai", "gpt-4o", "high")).toBeUndefined();
		expect(thinkingOptions("anthropic", "claude-3-5-sonnet-latest", "low")).toBeUndefined();
	});
});

describe("effortFromEnv", () => {
	it("reads AGENT_EFFORT and rejects anything else", () => {
		expect(effortFromEnv({})).toBeUndefined();
		expect(effortFromEnv({ AGENT_EFFORT: "mid" })).toBe("mid");
		expect(() => effortFromEnv({ AGENT_EFFORT: "max" })).toThrow("AGENT_EFFORT");
	});
});

describe("runAgent effort", () => {
	const usage = {
		inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 1, text: 1, reasoning: 0 },
	};
	/** The providerOptions the model call received. */
	async function sent(provider: string, modelId: string, effort?: Effort) {
		let got: unknown = "never called";
		const model = new MockLanguageModelV4({
			provider,
			modelId,
			doStream: async (o) => {
				got = o.providerOptions;
				return {
					stream: convertArrayToReadableStream([
						{ type: "text-start", id: "t" },
						{ type: "text-delta", id: "t", delta: "hi" },
						{ type: "text-end", id: "t" },
						{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
					] as never[]),
				};
			},
		});
		const result = runAgent({
			model,
			tools: {},
			active: () => [],
			projectId: "p",
			history: [{ role: "user", content: "go" }],
			limits: { idleMs: 1000, callMs: 1000, toolMs: 100, retries: 0 },
			mode: "manual",
			effort,
			approve: async () => ({ ok: true }),
		});
		await result.consumeStream();
		return got;
	}

	it("passes the model's thinking options to the call", async () => {
		expect(await sent("anthropic.messages", "claude-sonnet-4-5", "mid")).toMatchObject({
			anthropic: { thinking: { type: "enabled", budgetTokens: 8000 } },
		});
		expect(await sent("openai.responses", "gpt-5", "none")).toMatchObject({
			openai: { reasoningEffort: "minimal" },
		});
	});

	it("sends nothing without an effort or for an unsupported model", async () => {
		expect(await sent("anthropic.messages", "claude-sonnet-4-5")).toBeUndefined();
		expect(await sent("openai-compatible.chat", "llama3", "high")).toBeUndefined();
	});
});
