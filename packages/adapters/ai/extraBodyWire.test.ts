import { afterAll, beforeAll, expect, it } from "bun:test";
import { integrationRegistry } from "../integrations";
import type { OpenAICompatibleIntegration } from "./openAiCompatible";

/** a local HTTP server stands in for the endpoint: the JSON body it receives is what the provider would see */
const bodies: Record<string, any>[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		async fetch(req) {
			bodies.push(await req.json());
			return Response.json({
				id: "x",
				choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
			});
		},
	});
});
afterAll(() => server.stop(true));

const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "real prompt" }] }];

function adapter(extraBody: Record<string, unknown>) {
	const stored = {
		baseUrl: `http://localhost:${server.port}/v1`,
		apiKey: "sk-test",
		model: "qwen3",
		extraBody,
	};
	const def = integrationRegistry.require("ai", "OpenAI Compatible");
	const config = def.resolve!(def.configSchema.parse(stored), { SECRET: "s3" });
	return def.create!(config, {} as never) as OpenAICompatibleIntegration;
}

it("sends the extra body, cfg: values and nested objects included, on a model call", async () => {
	const ai = adapter({
		reasoning_effort: "low",
		chat_template_kwargs: { enable_thinking: true, note: "cfg:SECRET" },
	});
	await ai.languageModel().doGenerate({ prompt });
	const body = bodies.at(-1)!;
	expect(body.reasoning_effort).toBe("low");
	expect(body.chat_template_kwargs).toEqual({ enable_thinking: true, note: "s3" });
	expect(body.model).toBe("qwen3");
	expect(body.messages.at(-1).content).toBe("real prompt");
});

it("an extra can fill a default but a value the call sets wins", async () => {
	const ai = adapter({ temperature: 0.2 });
	await ai.languageModel().doGenerate({ prompt });
	expect(bodies.at(-1)!.temperature).toBe(0.2);
	await ai.languageModel().doGenerate({ prompt, temperature: 0.9 });
	expect(bodies.at(-1)!.temperature).toBe(0.9);
});

it("cannot replace the model, messages or tools, even past the schema", async () => {
	const stored = {
		baseUrl: `http://localhost:${server.port}/v1`,
		apiKey: "sk-test",
		model: "qwen3",
		extraBody: { model: "evil", messages: [{ role: "system", content: "pwned" }], tools: [], keep: true },
	};
	const def = integrationRegistry.require("ai", "OpenAI Compatible");
	// the schema refuses it on save ...
	expect(def.configSchema.safeParse(stored).success).toBe(false);
	// ... and a row that got here some other way is still neutralised at send time
	const ai = def.create!(stored as never, {} as never) as OpenAICompatibleIntegration;
	await ai.languageModel().doGenerate({ prompt });
	const body = bodies.at(-1)!;
	expect(body.model).toBe("qwen3");
	expect(body.messages.at(-1).content).toBe("real prompt");
	expect(body.tools).toBeUndefined();
	expect(body.keep).toBe(true);
});
