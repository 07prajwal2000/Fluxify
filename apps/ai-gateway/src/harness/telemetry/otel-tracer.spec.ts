import { describe, expect, it } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { FluxifyOtelTracer } from "./otel-tracer";

/** Exposes the usage extraction that turns a provider response into span
 *  attributes — the part that silently produced nothing before. */
class Probe extends FluxifyOtelTracer {
	attributes(output: any) {
		return (this as any).usageAttributes(output);
	}
}

const tracer = new Probe();

function generation(usage?: Record<string, any>) {
	const message = new AIMessage("ok");
	if (usage) (message as any).usage_metadata = usage;
	return [[{ text: "ok", message }]];
}

describe("FluxifyOtelTracer usage attributes", () => {
	it("reads usage from the message, where every provider puts it", () => {
		// `llmOutput.tokenUsage` is the OpenAI shape and is absent for Anthropic,
		// Google and Mistral — those calls used to trace as costing nothing.
		const attributes = tracer.attributes({
			generations: generation({
				input_tokens: 1200,
				output_tokens: 300,
				total_tokens: 1500,
				input_token_details: { cache_read: 1000, cache_creation: 200 },
			}),
		});

		expect(attributes).toEqual({
			"llm.token_count.prompt": 1200,
			"llm.token_count.completion": 300,
			"llm.token_count.total": 1500,
			"llm.token_count.prompt_details.cache_read": 1000,
			"llm.token_count.prompt_details.cache_write": 200,
		});
	});

	it("falls back to the OpenAI-shaped llmOutput when the message has none", () => {
		const attributes = tracer.attributes({
			generations: generation(),
			llmOutput: { tokenUsage: { promptTokens: 10, completionTokens: 4 } },
		});

		expect(attributes["llm.token_count.prompt"]).toBe(10);
		expect(attributes["llm.token_count.total"]).toBe(14);
	});

	it("reports nothing rather than zeros when the provider reports nothing", () => {
		// A missing count and a genuine zero are different facts; recording 0 here
		// would make an un-instrumented provider look free.
		expect(tracer.attributes({ generations: generation() })).toEqual({});
		expect(tracer.attributes(undefined)).toEqual({});
	});
});
