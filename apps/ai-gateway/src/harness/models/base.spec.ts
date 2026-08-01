import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	HumanMessage,
	ToolMessage,
	type BaseMessage,
} from "@langchain/core/messages";
import { BaseAgentWrapper, compactToolHistory } from "./base";
import { OpenAIAgentWrapper } from "./openai";
import { describeFailure } from "../index";
import { AgentNode } from "../types";
import { blockBuilderSchema } from "../agents/sub-agents/blockBuilder/schemas";

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
	parseSequence(responses: (string | Record<string, any>)[]) {
		const seen: BaseMessage[][] = [];
		let i = 0;
		const model = {
			invoke: async (messages: BaseMessage[]) => {
				seen.push(messages);
				const next = responses[Math.min(i++, responses.length - 1)];
				return typeof next === "string" ? { content: next } : next;
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

	it("parses a payload the model emitted as an escaped JSON string", async () => {
		// The "Unrecognized token '\'" failure: slicing from the first `{` used to
		// leave the escapes behind.
		expect(await wrapper.parse('"{\\"blocks\\":[\\"a\\"]}"')).toEqual({
			blocks: ["a"],
		});
		// Same drift without the surrounding quotes.
		expect(await wrapper.parse('{\\"blocks\\":[]}')).toEqual({ blocks: [] });
	});

	it("ignores braces the model appended after the payload", async () => {
		expect(await wrapper.parse('{"blocks":["a"]} — done! {see above}')).toEqual({
			blocks: ["a"],
		});
	});

	it("keeps braces that live inside strings", async () => {
		expect(await wrapper.parse('{"blocks":["a}b","{c"]}')).toEqual({
			blocks: ["a}b", "{c"],
		});
	});

	it("reads reasoning-model output parked outside content", async () => {
		expect(await wrapper.parse("", { reasoning: '{"blocks":[]}' })).toEqual({
			blocks: [],
		});
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

	it("carries the model's reasoning into the correction turn", async () => {
		const { result, seen } = wrapper.parseSequence([
			{
				content: '{"blocks":[1]}',
				additional_kwargs: { reasoning_content: "I picked numbers" },
			},
			{ content: '{"blocks":["a"]}' },
		]);
		expect(await result).toEqual({ blocks: ["a"] });

		const echoed = seen[1].at(-2)!;
		expect(echoed.getType()).toBe("ai");
		expect(echoed.additional_kwargs.reasoning_content).toBe("I picked numbers");
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

describe("fallbackStructuredOutput schema conversion", () => {
	it("produces a real JSON schema for the block builder schema, not an empty one", () => {
		// zod-to-json-schema (v3) reads zod v3 `_def` internals and silently emits
		// `{"$schema": "..."}` against a zod v4 schema — the prompt then tells the
		// model to match `{}` and it guesses field names. Guard against that regressing.
		const jsonSchema = z.toJSONSchema(blockBuilderSchema, {
			target: "draft-7",
			io: "output",
		}) as { properties?: Record<string, unknown> };

		expect(jsonSchema.properties).toBeTruthy();
		expect(Object.keys(jsonSchema.properties!).length).toBeGreaterThan(0);
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

describe("compactToolHistory", () => {
	const toolMsg = (name: string, content: string) =>
		new ToolMessage({ tool_call_id: `call_${name}`, name, content });

	it("leaves the most recent tool results verbatim", () => {
		const messages: BaseMessage[] = [
			new HumanMessage("build it"),
			toolMsg("a", JSON.stringify([1, 2, 3])),
			toolMsg("b", JSON.stringify([4, 5])),
		];
		compactToolHistory(messages);
		expect(messages[1]!.content).toBe(JSON.stringify([1, 2, 3]));
		expect(messages[2]!.content).toBe(JSON.stringify([4, 5]));
	});

	it("condenses older tool results and keeps them addressable", () => {
		const big = JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ i })));
		const messages: BaseMessage[] = [
			toolMsg("find_resource", big),
			toolMsg("b", "{}"),
			toolMsg("c", "{}"),
		];
		compactToolHistory(messages);

		const first = messages[0] as ToolMessage;
		expect(first.content).not.toBe(big);
		expect(String(first.content)).toContain("40 results");
		// The tool_call_id must survive — a ToolMessage without its matching id
		// is rejected by every provider.
		expect(first.tool_call_id).toBe("call_find_resource");
		expect(first.name).toBe("find_resource");
	});

	it("summarises non-JSON results by truncation", () => {
		const markdown = "x".repeat(500);
		const messages: BaseMessage[] = [
			toolMsg("a", markdown),
			toolMsg("b", "{}"),
			toolMsg("c", "{}"),
		];
		compactToolHistory(messages);
		expect(String(messages[0]!.content).length).toBeLessThan(400);
	});

	it("is idempotent — a second pass doesn't summarise the summary", () => {
		const messages: BaseMessage[] = [
			toolMsg("a", JSON.stringify([1, 2, 3])),
			toolMsg("b", "{}"),
			toolMsg("c", "{}"),
		];
		compactToolHistory(messages);
		const once = messages[0]!.content;
		compactToolHistory(messages);
		expect(messages[0]!.content).toBe(once);
	});
});
