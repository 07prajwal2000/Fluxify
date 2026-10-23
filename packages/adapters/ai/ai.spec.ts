import { describe, expect, it } from "bun:test";
import { integrationRegistry } from "../integrations";
import { AnthropicIntegration } from "./anthropic";
import type { BaseAiIntegration } from "./baseAiIntegration";
import { GeminiIntegration } from "./gemini";
import { MistralIntegration } from "./mistral";
import { OpenAIIntegration } from "./openAi";
import { OpenAICompatibleIntegration } from "./openAiCompatible";

const appConfig = new Map([
	["AI_KEY", "sk-test-from-app-config"],
	["AI_URL", "http://llm.local/v1"],
]);

/** what a stored row looks like today, `cfg:` references unexpanded */
const ROWS: [typeof BaseAiIntegration, Record<string, string>, string][] = [
	[OpenAIIntegration, { apiKey: "cfg:AI_KEY", model: "gpt-4o-mini" }, "https://api.openai.com/v1/"],
	[AnthropicIntegration, { apiKey: "cfg:AI_KEY", model: "claude-haiku-4-5" }, "https://api.anthropic.com/v1/"],
	[GeminiIntegration, { apiKey: "cfg:AI_KEY", model: "gemini-2.5-flash" }, "https://generativelanguage.googleapis.com/v1beta/"],
	[MistralIntegration, { apiKey: "cfg:AI_KEY", model: "mistral-small-latest" }, "https://api.mistral.ai/v1/"],
	[
		OpenAICompatibleIntegration,
		{ apiKey: "cfg:AI_KEY", model: "llama3.2", baseUrl: "cfg:AI_URL" },
		"http://llm.local/v1/",
	],
];

/** records each request; the response is not a real one, so the call itself may fail after */
function recorder(body: unknown = {}) {
	const calls: { url: string; headers: Headers; body: any }[] = [];
	const fetch = (async (url: string, init?: RequestInit) => {
		calls.push({
			url: String(url),
			headers: new Headers(init?.headers),
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		});
		return Response.json(body);
	}) as unknown as typeof globalThis.fetch;
	return { calls, fetch };
}

const keyOf = (h: Headers) =>
	h.get("x-api-key") ?? h.get("x-goog-api-key") ?? h.get("authorization")?.replace("Bearer ", "");

describe.each(ROWS)("%p", (Provider, row, baseUrl) => {
	const variant = Provider.variant;

	it("today's stored row still validates", () => {
		expect(integrationRegistry.require("ai", variant).configSchema.safeParse(row).success).toBe(true);
	});

	it("calls the default model at the base URL with the key from app config", async () => {
		const { calls, fetch } = recorder();
		const config = Provider.ExtractConnectionInfo(row as any, appConfig);
		const model = new Provider(config, fetch).languageModel();
		expect(model.modelId).toBe(row.model);
		await model
			.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
			.catch(() => {});
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url.startsWith(baseUrl)).toBe(true);
		expect(keyOf(calls[0]!.headers)).toBe("sk-test-from-app-config");
		const sent = calls[0]!.body.model ?? calls[0]!.url;
		expect(sent).toContain(row.model!);
		// the stored row keeps its reference
		expect(row.apiKey).toBe("cfg:AI_KEY");
	});

	it("another model id overrides the default", () => {
		const config = Provider.ExtractConnectionInfo(row as any, appConfig);
		expect(new Provider(config).languageModel("other-model").modelId).toBe("other-model");
	});

	it("lists models with the key, the cheapest real call", async () => {
		const listing =
			Provider === GeminiIntegration
				? { models: [{ name: "models/gemini-2.5-flash" }] }
				: { data: [{ id: "m1" }] };
		const { calls, fetch } = recorder(listing);
		const config = Provider.ExtractConnectionInfo(row as any, appConfig);
		expect(await Provider.ListModels(config, fetch)).toEqual([
			Provider === GeminiIntegration ? "gemini-2.5-flash" : "m1",
		]);
		expect(calls[0]!.url).toBe(`${baseUrl}models`);
		expect(keyOf(calls[0]!.headers)).toBe("sk-test-from-app-config");
	});
});

it("a refused listing throws the provider's status", async () => {
	const fetch = (async () => new Response("bad key", { status: 401 })) as unknown as typeof globalThis.fetch;
	await expect(OpenAIIntegration.ListModels({ apiKey: "x", model: "m" }, fetch)).rejects.toThrow("401 bad key");
});

it("a missing app config key is reported", () => {
	expect(() => OpenAIIntegration.ExtractConnectionInfo({ apiKey: "cfg:NOPE", model: "m" }, new Map())).toThrow(
		"API key not found",
	);
});
