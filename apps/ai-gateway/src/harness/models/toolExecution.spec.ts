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

	// One wrapper serves the whole run, so a route the orchestrator's first task
	// looked up is a route its siblings should not pay to look up again.
	it("shares database reads across invocations of the same wrapper", async () => {
		const counts = { find_resource: 0, get_agent_output: 0 };
		const toolNamed = (name: keyof typeof counts) =>
			tool(async () => `${name}-${++counts[name]}`, {
				name,
				description: "read",
				schema: z.object({ id: z.string() }),
			}) as unknown as StructuredTool;

		class SharedWrapper extends BaseAgentWrapper {
			// `createModel` is called once per wrapper, so the script has to rewind
			// for the second invocation rather than run off the end of the array.
			step = 0;

			protected createModel(): BaseChatModel {
				const responses = [
					new AIMessage({
						content: "",
						tool_calls: [
							{ id: "c1", name: "find_resource", args: { id: "r-1" } },
							{ id: "c2", name: "get_agent_output", args: { id: "t-1" } },
						],
					}),
					new AIMessage({
						content: "",
						tool_calls: [{ id: "c3", name: SUBMIT_RESULT_TOOL, args: { blocks: ["a"] } }],
					}),
				];
				const model: any = {
					bindTools: () => model,
					invoke: async () => responses[this.step++]!,
				};
				return model as BaseChatModel;
			}

			run() {
				this.step = 0;
				return this.invokeAgent({
					zodSchema: resultSchema,
					systemPrompt: "you are a builder",
					userQuery: "build it",
					tools: [toolNamed("find_resource"), toolNamed("get_agent_output")],
				});
			}
		}

		const wrapper = new SharedWrapper("test-model");
		await wrapper.run();
		await wrapper.run();

		expect(counts.find_resource).toBe(1);
		// Its answer is a snapshot of this invocation's sibling results, so it must
		// not be replayed to a later sub-agent whose snapshot has more in it.
		expect(counts.get_agent_output).toBe(2);
	});
});
