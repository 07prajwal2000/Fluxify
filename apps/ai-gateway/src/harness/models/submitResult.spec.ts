import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { tool, type StructuredTool } from "@langchain/core/tools";
import { BaseAgentWrapper } from "./base";
import { SUBMIT_RESULT_TOOL } from "./toolLoop";

const schema = z.object({ blocks: z.array(z.string()) });

describe("submit_result", () => {
	const pingTool = tool(async () => "pong", {
		name: "ping",
		description: "ping",
		schema: z.object({}),
	}) as unknown as StructuredTool;

	/** Replays a scripted list of model responses through the real tool loop. */
	class LoopWrapper extends BaseAgentWrapper {
		calls: BaseMessage[][] = [];
		boundTools: StructuredTool[] = [];

		constructor(
			private responses: AIMessage[],
			private validateResult?: (result: unknown) => string | null,
		) {
			super("test-model");
		}

		protected createModel(): BaseChatModel {
			let i = 0;
			const model: any = {
				bindTools: (tools: StructuredTool[]) => {
					this.boundTools = tools;
					return model;
				},
				invoke: async (messages: BaseMessage[]) => {
					this.calls.push([...messages]);
					return this.responses[Math.min(i++, this.responses.length - 1)];
				},
			};
			return model as BaseChatModel;
		}

		run() {
			return this.invokeAgent({
				zodSchema: schema,
				systemPrompt: "you are a builder",
				userQuery: "build it",
				tools: [pingTool],
				validateResult: this.validateResult,
			});
		}
	}

	const submitCall = (args: unknown, id = "call_1") =>
		new AIMessage({
			content: "",
			tool_calls: [{ id, name: SUBMIT_RESULT_TOOL, args: args as any }],
		});
	const rawSubmitCall = (args: unknown, id = "call_1") =>
		new AIMessage({
			content: "",
			additional_kwargs: {
				tool_calls: [
					{
						id,
						type: "function",
						function: {
							name: SUBMIT_RESULT_TOOL,
							arguments: JSON.stringify(args),
						},
					},
				],
			},
		});

	it("returns the tool arguments as the answer in a single model call", async () => {
		const wrapper = new LoopWrapper([submitCall({ blocks: ["a"] })]);
		expect(await wrapper.run()).toEqual({ blocks: ["a"] });
		// The whole point: no second generation of the same content.
		expect(wrapper.calls.length).toBe(1);
		expect(wrapper.boundTools.map((t) => t.name)).toContain(SUBMIT_RESULT_TOOL);
	});

	it("accepts a provider-native submit_result call without regenerating it", async () => {
		const wrapper = new LoopWrapper([rawSubmitCall({ blocks: ["a"] })]);
		expect(await wrapper.run()).toEqual({ blocks: ["a"] });
		expect(wrapper.calls.length).toBe(1);
	});

	it("rejects invalid arguments in-loop and accepts the correction", async () => {
		const wrapper = new LoopWrapper([
			submitCall({ blocks: [1] }),
			submitCall({ blocks: ["a"] }, "call_2"),
		]);
		expect(await wrapper.run()).toEqual({ blocks: ["a"] });
		expect(wrapper.calls.length).toBe(2);

		// The rejected call must still be answered — a tool_call with no matching
		// result is rejected by the provider.
		const answer = wrapper.calls[1]!.at(-1) as ToolMessage;
		expect(answer.tool_call_id).toBe("call_1");
		expect(String(answer.content)).toContain("blocks.0");
	});

	it("returns domain validation feedback to the same tool loop", async () => {
		const wrapper = new LoopWrapper(
			[
				submitCall({ blocks: ["invalid"] }),
				submitCall({ blocks: ["valid"] }, "call_2"),
			],
			(result) =>
				(result as { blocks: string[] }).blocks.includes("invalid")
					? "Block configuration is invalid."
					: null,
		);

		expect(await wrapper.run()).toEqual({ blocks: ["valid"] });
		expect(wrapper.calls.length).toBe(2);
		expect(String((wrapper.calls[1]!.at(-1) as ToolMessage).content)).toContain(
			"Block configuration is invalid.",
		);
	});

	it("accepts an answer written as free text without regenerating it", async () => {
		const wrapper = new LoopWrapper([new AIMessage('{"blocks":["a"]}')]);
		expect(await wrapper.run()).toEqual({ blocks: ["a"] });
		expect(wrapper.calls.length).toBe(1);
	});
});
