import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool, type StructuredTool } from "@langchain/core/tools";
import { BaseAgentWrapper } from "./base";
import { SUBMIT_RESULT_TOOL } from "./toolLoop";

const resultSchema = z.object({ blocks: z.array(z.string()) });

describe("read-tool memoization", () => {
	it("replays equivalent calls without another execution", async () => {
		let executions = 0;
		const readTool = tool(
			async () => `result-${++executions}`,
			{
				name: "find_resource",
				description: "read",
				schema: z.object({ a: z.number(), b: z.number() }),
			},
		) as unknown as StructuredTool;

		class ReadToolWrapper extends BaseAgentWrapper {
			calls: BaseMessage[][] = [];

			protected createModel(): BaseChatModel {
				let index = 0;
				const responses = [
					new AIMessage({ content: "", tool_calls: [{ id: "call_1", name: "find_resource", args: { b: 2, a: 1 } }] }),
					new AIMessage({ content: "", tool_calls: [{ id: "call_2", name: "find_resource", args: { a: 1, b: 2 } }] }),
					new AIMessage({ content: "", tool_calls: [{ id: "call_3", name: SUBMIT_RESULT_TOOL, args: { blocks: ["a"] } }] }),
				];
				const model: any = {
					bindTools: () => model,
					invoke: async (messages: BaseMessage[]) => {
						this.calls.push([...messages]);
						return responses[index++]!;
					},
				};
				return model as BaseChatModel;
			}

			run() {
				return this.invokeAgent({
					zodSchema: resultSchema,
					systemPrompt: "you are a builder",
					userQuery: "build it",
					tools: [readTool],
				});
			}
		}

		const wrapper = new ReadToolWrapper("test-model");
		expect(await wrapper.run()).toEqual({ blocks: ["a"] });
		expect(executions).toBe(1);
		const replay = wrapper.calls[2]!.find(
			(message): message is ToolMessage =>
				message instanceof ToolMessage && message.tool_call_id === "call_2",
		);
		expect(replay?.content).toBe("result-1");
	});
});
