import { describe, expect, it } from "bun:test";
import { modelFromEnv, modelFromIntegration } from "./model";

const KEY = "test-key";
const model = (env: Record<string, string>) => modelFromEnv(env) as { provider: string; modelId: string };

describe("modelFromEnv", () => {
	it.each([
		["openai", "gpt-5", "openai"],
		["anthropic", "claude-sonnet-4-5", "anthropic"],
		["google", "gemini-2.5-pro", "google"],
		["mistral", "mistral-medium-latest", "mistral"],
	])("maps %s to its SDK provider", (provider, id, prefix) => {
		const m = model({ AGENT_PROVIDER: provider, AGENT_MODEL: id, AGENT_API_KEY: KEY });
		expect(m.provider.startsWith(prefix)).toBe(true);
		expect(m.modelId).toBe(id);
	});

	it("maps openai-compatible to a base URL (Ollama, DeepSeek, OpenRouter)", () => {
		const m = model({
			AGENT_PROVIDER: "openai-compatible",
			AGENT_MODEL: "deepseek-chat",
			AGENT_BASE_URL: "https://api.deepseek.com",
			AGENT_API_KEY: KEY,
		});
		expect(m.provider).toStartWith("openai-compatible");
		expect(m.modelId).toBe("deepseek-chat");
	});

	it("says what is wrong with the env", () => {
		expect(() => model({ AGENT_PROVIDER: "cohere", AGENT_MODEL: "x" })).toThrow("AGENT_PROVIDER");
		expect(() => model({ AGENT_PROVIDER: "openai" })).toThrow("AGENT_MODEL");
		expect(() => model({ AGENT_PROVIDER: "openai-compatible", AGENT_MODEL: "llama3" })).toThrow(
			"AGENT_BASE_URL",
		);
	});

	it("reads another env set by prefix", () => {
		const m = modelFromEnv(
			{ AGENT_JUDGE_PROVIDER: "openai", AGENT_JUDGE_MODEL: "gpt-5", AGENT_JUDGE_API_KEY: KEY },
			"AGENT_JUDGE",
		) as { modelId: string };
		expect(m.modelId).toBe("gpt-5");
		expect(() => modelFromEnv({}, "AGENT_JUDGE")).toThrow("AGENT_JUDGE_PROVIDER");
	});
});

describe("modelFromIntegration", () => {
	it("maps a stored integration to its provider", () => {
		const m = modelFromIntegration({ variant: "Gemini", model: "gemini-2.5-pro", apiKey: KEY }) as any;
		expect(m.provider.startsWith("google")).toBe(true);
		expect(m.modelId).toBe("gemini-2.5-pro");
		const local = modelFromIntegration({
			variant: "OpenAI Compatible",
			model: "llama3",
			baseUrl: "http://localhost:11434/v1",
		}) as any;
		expect(local.modelId).toBe("llama3");
	});

	it("refuses an unknown variant", () => {
		expect(() => modelFromIntegration({ variant: "Cohere", model: "x" })).toThrow("Cohere");
	});
});
