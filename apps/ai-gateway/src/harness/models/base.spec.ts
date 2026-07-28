import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { BaseAgentWrapper } from "./base";
import { OpenAIAgentWrapper } from "./openai";
import { describeFailure } from "../index";
import { AgentNode } from "../types";

const schema = z.object({ blocks: z.array(z.string()) });

/** Exposes the protected fallback path and lets a test supply a canned response. */
class TestWrapper extends BaseAgentWrapper {
	protected getModel(): BaseChatModel {
		throw new Error("not used");
	}

	parse(content: unknown, additional_kwargs: Record<string, any> = {}) {
		const model = { invoke: async () => ({ content, additional_kwargs }) } as any;
		return this.fallbackStructuredOutput(model, [], schema);
	}

	/** Replays `responses` one per attempt, recording what each attempt was sent. */
	parseSequence(responses: string[]) {
		const seen: BaseMessage[][] = [];
		let i = 0;
		const model = {
			invoke: async (messages: BaseMessage[]) => {
				seen.push(messages);
				return { content: responses[Math.min(i++, responses.length - 1)] };
			},
		} as any;
		return { result: this.fallbackStructuredOutput(model, [], schema), seen };
	}
}

describe("fallbackStructuredOutput", () => {
	const wrapper = new TestWrapper("test-model");

	it("parses fenced JSON with surrounding prose", async () => {
		const result = await wrapper.parse(
			'Sure! Here is the plan:\n```json\n{"blocks":["a"]}\n```\nHope that helps.',
		);
		expect(result).toEqual({ blocks: ["a"] });
	});

	it("parses JSON wrapped in prose without a code fence", async () => {
		const result = await wrapper.parse('Here you go: {"blocks":["a","b"]} done.');
		expect(result).toEqual({ blocks: ["a", "b"] });
	});

	it("flattens array content blocks", async () => {
		const result = await wrapper.parse([
			{ type: "thinking", thinking: "hmm" },
			{ type: "text", text: '{"blocks":[]}' },
		]);
		expect(result).toEqual({ blocks: [] });
	});

	it("reports empty responses instead of crashing on JSON.parse", async () => {
		expect(wrapper.parse("")).rejects.toThrow(/empty response/i);
	});

	it("re-asks with the validation error and accepts the corrected answer", async () => {
		const { result, seen } = wrapper.parseSequence([
			'{"blocks":[{"wrong":1}]}',
			'{"blocks":["a"]}',
		]);
		expect(await result).toEqual({ blocks: ["a"] });

		// Second attempt carries the correction, and ends on a human turn so
		// providers like Mistral don't reject the request.
		const retryMessages = seen[1];
		expect(retryMessages.length).toBeGreaterThan(seen[0].length);
		expect(retryMessages.at(-1)!.getType()).toBe("human");
		expect(retryMessages.at(-1)!.content).toContain("blocks.0");
	});

	it("gives up after the attempt budget with the last validation error", async () => {
		const { result, seen } = wrapper.parseSequence(['{"blocks":[1]}']);
		expect(result).rejects.toThrow(/after 3 attempts/);
		await result.catch(() => {});
		expect(seen.length).toBe(3);
	});
});

describe("OpenAIAgentWrapper", () => {
	class Probe extends OpenAIAgentWrapper {
		build() {
			return this.getModel();
		}
		usesNativeStructuredOutput() {
			return this.supportsStructuredOutput();
		}
	}

	it("passes the API key through to the client", () => {
		// ChatOpenAI reads `apiKey` only — the `openAIApiKey` alias is dropped on
		// chat models, which silently produced "Missing credentials".
		const model = new Probe("deepseek-chat", "sk-live", undefined, "https://api.deepseek.com").build();
		expect((model as any).apiKey).toBe("sk-live");
	});

	it("builds against a keyless OpenAI-compatible endpoint", () => {
		const wrapper = new Probe(
			"llama3",
			undefined,
			undefined,
			"http://localhost:11434/v1",
		);
		expect(() => wrapper.build()).not.toThrow();
		expect(wrapper.usesNativeStructuredOutput()).toBe(false);
	});

	it("still uses native structured output for OpenAI itself", () => {
		expect(
			new Probe("gpt-4o", "sk-test").usesNativeStructuredOutput(),
		).toBe(true);
	});
});

describe("describeFailure", () => {
	it("names the failing node and explains structured-output failures", () => {
		const msg = describeFailure(
			new Error("Failed to parse structured output. Model response: ."),
			AgentNode.BLOCK_BUILDER,
		);
		expect(msg).toContain("block builder");
		expect(msg).toContain("required format");
	});

	it("explains provider timeouts", () => {
		const msg = describeFailure(
			new DOMException("The operation timed out.", "TimeoutError"),
			AgentNode.BLOCK_BUILDER,
		);
		expect(msg).toContain("took too long");
	});

	it("reads a message out of non-Error rejections", () => {
		expect(describeFailure({ code: "ETIMEDOUT" })).toContain("ETIMEDOUT");
	});

	it("falls back to a generic explanation", () => {
		expect(describeFailure(new Error("boom"))).toContain("unexpected error");
	});
});
