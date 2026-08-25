import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { BaseAgentWrapper } from "./base";

const schema = z.object({ blocks: z.array(z.string()) });

class NativeValidationWrapper extends BaseAgentWrapper {
	nativeCalls: BaseMessage[][] = [];
	fallbackCalls: BaseMessage[][] = [];

	protected supportsStructuredOutput(): boolean {
		return true;
	}

	protected createModel(): BaseChatModel {
		const model = {
			withStructuredOutput: () => ({
				invoke: async (messages: BaseMessage[]) => {
					this.nativeCalls.push([...messages]);
					return {
						raw: new AIMessage('{"blocks":["invalid"]}'),
						parsed: { blocks: ["invalid"] },
					};
				},
			}),
			invoke: async (messages: BaseMessage[]) => {
				this.fallbackCalls.push([...messages]);
				return new AIMessage('{"blocks":["valid"]}');
			},
		};
		return model as unknown as BaseChatModel;
	}

	run() {
		return this.invokeAgent({
			zodSchema: schema,
			systemPrompt: "you are a builder",
			userQuery: "build it",
			validateResult: (result) =>
				(result as { blocks: string[] }).blocks.includes("invalid")
					? "Block configuration is invalid."
					: null,
		});
	}
}

describe("native structured output", () => {
	it("feeds a domain rejection into the corrective fallback", async () => {
		const wrapper = new NativeValidationWrapper("test-model");
		expect(await wrapper.run()).toEqual({ blocks: ["valid"] });
		expect(wrapper.nativeCalls).toHaveLength(1);
		expect(wrapper.fallbackCalls).toHaveLength(1);

		const correction = wrapper.fallbackCalls[0]!.find(
			(message) =>
				message.getType() === "human" &&
				String(message.content).includes("Block configuration is invalid."),
		);
		expect(correction).toBeDefined();
	});
});
