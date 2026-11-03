import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
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

describe("modelFromIntegration headers", () => {
	afterEach(() => mock.restore());

	it.each([
		["OpenAI", "gpt-4o"],
		["Anthropic", "claude-sonnet-4-5"],
		["Gemini", "gemini-2.5-pro"],
		["Mistral", "mistral-small-latest"],
		["OpenAI Compatible", "llama3"],
	])("%s sends the integration headers", async (variant, id) => {
		const calls: Headers[] = [];
		spyOn(globalThis, "fetch").mockImplementation((async (_url: unknown, init?: RequestInit) => {
			calls.push(new Headers(init?.headers));
			return Response.json({});
		}) as never);
		const m = modelFromIntegration({
			variant,
			model: id,
			apiKey: KEY,
			baseUrl: "http://llm.local/v1",
			headers: { "x-org": "acme" },
		}) as any;
		await m
			.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
			.catch(() => {});
		expect(calls).toHaveLength(1);
		expect(calls[0]!.get("x-org")).toBe("acme");
	});
});

describe("modelFromIntegration extraBody (#1068)", () => {
	afterEach(() => mock.restore());

	const send = async (extraBody: Record<string, unknown>) => {
		const bodies: Record<string, any>[] = [];
		spyOn(globalThis, "fetch").mockImplementation((async (_url: unknown, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));
			return Response.json({});
		}) as never);
		const m = modelFromIntegration({
			variant: "OpenAI Compatible",
			model: "qwen3",
			apiKey: KEY,
			baseUrl: "http://llm.local/v1",
			extraBody,
		}) as any;
		await m
			.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "real" }] }] })
			.catch(() => {});
		return bodies[0]!;
	};

	it("adds the extra body to the agent's request", async () => {
		const body = await send({ reasoning_effort: "high", chat_template_kwargs: { enable_thinking: true } });
		expect(body.reasoning_effort).toBe("high");
		expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
	});

	it("cannot replace what the agent sends: model, messages, tools", async () => {
		const body = await send({ model: "evil", messages: [{ role: "system", content: "pwned" }], tools: [] });
		expect(body.model).toBe("qwen3");
		expect(body.messages.at(-1).content).toBe("real");
		expect(body.tools).toBeUndefined();
	});
});
