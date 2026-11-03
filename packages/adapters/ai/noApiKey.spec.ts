import { expect, it } from "bun:test";
import { integrationRegistry } from "../integrations";
import { OpenAICompatibleIntegration } from "./openAiCompatible";

const row = { baseUrl: "http://localhost:11434/v1", model: "llama3" };
const schemaOf = (variant: string) => integrationRegistry.require("ai", variant).configSchema;

it("OpenAI Compatible takes no API key: missing means an empty string", () => {
	const schema = schemaOf("OpenAI Compatible");
	expect(schema.parse(row).apiKey).toBe("");
	expect(schema.parse({ ...row, apiKey: "" }).apiKey).toBe("");
	expect(schema.safeParse({ ...row, apiKey: "cfg:KEY" }).success).toBe(true);
	expect(schema.safeParse({ ...row, apiKey: "sk-real" }).success).toBe(true);
	// a one-character key is still a typo
	expect(schema.safeParse({ ...row, apiKey: "k" }).success).toBe(false);
});

it("the other providers still require one", () => {
	for (const variant of ["OpenAI", "Anthropic", "Gemini", "Mistral"]) {
		expect(schemaOf(variant).safeParse({ model: "m" }).success).toBe(false);
		expect(schemaOf(variant).safeParse({ model: "m", apiKey: "" }).success).toBe(false);
	}
});

it("with no key, no Authorization header is sent on a model call or a listing", async () => {
	const seen: Headers[] = [];
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		seen.push(new Headers(init?.headers));
		return Response.json({
			data: [{ id: "llama3" }],
			choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
		});
	}) as unknown as typeof globalThis.fetch;
	const config = schemaOf("OpenAI Compatible").parse(row) as ConstructorParameters<
		typeof OpenAICompatibleIntegration
	>[0];
	await OpenAICompatibleIntegration.ListModels(config, fetch);
	await new OpenAICompatibleIntegration(config, fetch)
		.languageModel()
		.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
	expect(seen).toHaveLength(2);
	for (const headers of seen) expect(headers.has("authorization")).toBe(false);
});
