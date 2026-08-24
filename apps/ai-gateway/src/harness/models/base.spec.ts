import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	AIMessage,
	AIMessageChunk,
	HumanMessage,
	SystemMessage,
	ToolMessage,
	type BaseMessage,
} from "@langchain/core/messages";
import { tool, type StructuredTool } from "@langchain/core/tools";
import { BaseAgentWrapper } from "./base";
import {
	SUBMIT_RESULT_TOOL,
	asHistoryMessage,
	compactToolHistory,
	flattenToolMessages,
} from "./toolLoop";
import { OpenAIAgentWrapper } from "./openai";
import { AnthropicAgentWrapper } from "./anthropic";
import { RunBudget, RunBudgetExceededError } from "./budget";
import { withRetry } from "../../lib/retry";
import { describeFailure } from "../index";
import { UNTRUSTED_DATA_RULE } from "../internal/untrusted";
import { AgentNode } from "../types";
import { blockBuilderSchema } from "../agents/sub-agents/blockBuilder/schemas";

const schema = z.object({ blocks: z.array(z.string()) });

/** Exposes the protected fallback path and lets a test supply a canned response. */
class TestWrapper extends BaseAgentWrapper {
	protected createModel(): BaseChatModel {
		throw new Error("not used");
	}

	parse(content: unknown, additional_kwargs: Record<string, any> = {}) {
		const model = { invoke: async () => ({ content, additional_kwargs }) } as any;
		return this.fallbackStructuredOutput(model, [], schema);
	}

	/** Replays `responses` one per attempt, recording what each attempt was sent. */
	parseSequence(
		responses: (string | Record<string, any>)[],
		history: BaseMessage[] = [],
	) {
		const seen: BaseMessage[][] = [];
		let i = 0;
		const model = {
			invoke: async (messages: BaseMessage[]) => {
				seen.push(messages);
				const next = responses[Math.min(i++, responses.length - 1)];
				return typeof next === "string" ? { content: next } : next;
			},
		} as any;
		return {
			result: this.fallbackStructuredOutput(model, history, schema),
			seen,
		};
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

	it("puts the JSON contract in the last turn, not in the system prompt", async () => {
		// Buried at the end of a long system prompt, the contract loses to the
		// user's question — providers that ignore `response_format` answer in
		// prose and attempt 1 is wasted. Attempt 2 only worked because the
		// correction was the last thing the model read.
		const { result, seen } = wrapper.parseSequence(
			['{"blocks":[]}'],
			[new SystemMessage("You are the router."), new HumanMessage("build a route")],
		);
		expect(await result).toEqual({ blocks: [] });

		const sent = seen[0]!;
		expect(sent.at(-1)!.getType()).toBe("human");
		expect(sent.at(-1)!.content).toContain("JSON schema");
		// The agent's own prompt is left exactly as the agent wrote it.
		expect(sent[0]!.content).toBe("You are the router.");
		expect(sent.at(-2)!.content).toBe("build a route");
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

describe("prompt caching", () => {
	/** Records every message array sent, and how often the client was built. */
	class CountingWrapper extends BaseAgentWrapper {
		built = 0;
		calls: BaseMessage[][] = [];

		protected createModel(): BaseChatModel {
			this.built++;
			return {
				invoke: async (messages: BaseMessage[]) => {
					this.calls.push([...messages]);
					return new AIMessage("ok");
				},
			} as unknown as BaseChatModel;
		}

		run(options: Parameters<BaseAgentWrapper["invokeAgent"]>[0]) {
			return this.invokeAgent(options);
		}
	}

	it("builds the chat client once per wrapper, not once per call", async () => {
		const wrapper = new CountingWrapper("test-model");
		await wrapper.run({ systemPrompt: "static", userQuery: "a" });
		await wrapper.run({ systemPrompt: "static", userQuery: "b" });
		expect(wrapper.built).toBe(1);
	});

	it("keeps volatile context out of the system prompt", async () => {
		const wrapper = new CountingWrapper("test-model");
		await wrapper.run({
			systemPrompt: "you are the planner",
			context: "## Current context\nroute abc",
			userQuery: "build it",
		});

		const sent = wrapper.calls[0]!;
		// The cached prefix: byte-identical whatever the run's context is. The
		// untrusted-content rule is part of it precisely because it never varies.
		expect(sent[0]!.getType()).toBe("system");
		expect(sent[0]!.content).toBe(
			`you are the planner\n\n${UNTRUSTED_DATA_RULE}`,
		);
		// Context rides with the user's turn, ahead of the request itself.
		expect(sent.at(-1)!.getType()).toBe("human");
		expect(sent.at(-1)!.content).toBe(
			"## Current context\nroute abc\n\nbuild it",
		);
	});

	it("marks the Anthropic system block as a cache breakpoint", () => {
		class Probe extends AnthropicAgentWrapper {
			system(text: string) {
				return this.buildSystemMessage(text);
			}
		}
		const content = new Probe("claude-sonnet-4-5", "sk-test").system("prompt")
			.content as Array<Record<string, any>>;

		expect(content).toEqual([
			{ type: "text", text: "prompt", cache_control: { type: "ephemeral" } },
		]);
	});

	it("leaves the cacheable prefix untouched when history is compacted", () => {
		// #148 flagged compaction and prefix caching as mutually exclusive. They
		// are not: compaction only ever rewrites near the tail, so everything
		// ahead of that point stays byte-identical and still hits the cache.
		const history: BaseMessage[] = [
			new SystemMessage("static prompt"),
			new HumanMessage("build it"),
		];
		const addToolTurn = (name: string) => {
			history.push(new AIMessage({ content: "", tool_calls: [] }));
			history.push(
				new ToolMessage({
					tool_call_id: `call_${name}`,
					name,
					content: JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ i }))),
				}),
			);
		};

		addToolTurn("a");
		addToolTurn("b");
		addToolTurn("c");
		compactToolHistory(history);
		const before = history.map((m) => JSON.stringify(m.content));

		addToolTurn("d");
		compactToolHistory(history);
		const after = history.map((m) => JSON.stringify(m.content));

		// The first message that changed — everything before it is a cache hit.
		const diverged = after.findIndex((c, i) => c !== before[i]);
		expect(diverged).toBeGreaterThan(0);
		// It is the third-newest tool result, not the system prompt or the query.
		expect(history.length - diverged).toBeLessThanOrEqual(5);
		expect(history[0]!.content).toBe("static prompt");
	});
});

describe("run budget", () => {
	/** Answers with a fixed token cost, and counts how often it was asked. */
	class BudgetedWrapper extends BaseAgentWrapper {
		calls = 0;

		protected createModel(): BaseChatModel {
			return {
				invoke: async () => {
					this.calls++;
					return new AIMessage({
						content: "ok",
						usage_metadata: {
							input_tokens: 300,
							output_tokens: 20,
							total_tokens: 320,
							input_token_details: { cache_read: 200 },
						},
					});
				},
			} as unknown as BaseChatModel;
		}

		run(options: Parameters<BaseAgentWrapper["invokeAgent"]>[0]) {
			return this.invokeAgent(options);
		}
	}

	it("books every model call against the run's usage", async () => {
		const wrapper = new BudgetedWrapper("test-model");
		const budget = new RunBudget({ deadlineMs: 60_000, tokenBudget: 0 });
		wrapper.setRunBudget(budget);

		await wrapper.run({ systemPrompt: "s", userQuery: "a", agentNode: "planner" });

		const usage = budget.snapshot();
		expect(usage.calls).toBe(1);
		expect(usage.totalTokens).toBe(320);
		expect(usage.cachedInputTokens).toBe(200);
		expect(usage.byAgent.planner!.calls).toBe(1);
	});

	it("separates earlier conversation history from current-run input", async () => {
		const wrapper = new BudgetedWrapper("test-model");
		const budget = new RunBudget({ deadlineMs: 60_000, tokenBudget: 0 });
		wrapper.setRunBudget(budget);

		await wrapper.run({
			messages: [new HumanMessage("12345678")],
			historyMessageCount: 1,
			userQuery: "current request",
			agentNode: "planner",
		});

		expect(budget.snapshot().historyInputTokens).toBe(2);
	});

	it("refuses to spend past the ceiling instead of failing mid-call", async () => {
		const wrapper = new BudgetedWrapper("test-model");
		const budget = new RunBudget({ deadlineMs: 60_000, tokenBudget: 300 });
		wrapper.setRunBudget(budget);

		await wrapper.run({ userQuery: "a", agentNode: "planner" });
		// The first call spent 320 of a 300-token budget, so the second is never
		// made — the provider isn't billed for work the run can no longer use.
		await expect(
			wrapper.run({ userQuery: "b", agentNode: "planner" }),
		).rejects.toThrow(RunBudgetExceededError);
		expect(wrapper.calls).toBe(1);
	});

	it("is not retried — a blown budget only gets more blown", async () => {
		// withRetry would otherwise re-issue the call three more times.
		let attempts = 0;
		await expect(
			withRetry(
				async () => {
					attempts++;
					throw new RunBudgetExceededError("Run budget exceeded: out of time.");
				},
				{ maxRetries: 3, baseDelayMs: 1 },
			),
		).rejects.toThrow(RunBudgetExceededError);
		expect(attempts).toBe(1);
	});

	it("explains a budget failure as a harness limit, not a provider problem", () => {
		const msg = describeFailure(
			new RunBudgetExceededError(
				"Run budget exceeded: this request used 2000000 tokens, above the 2000000 token limit.",
			),
			AgentNode.BLOCK_BUILDER,
		);
		expect(msg).toContain("limit set for a single request");
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

	it("tells prose-instead-of-JSON apart from running out of output space", () => {
		// Both mention JSON but need opposite advice: one is the provider ignoring
		// the JSON format, the other is a model that reasoned away its budget.
		const prose = describeFailure(
			new Error('JSON Parse error: Unexpected identifier "Fluxify"'),
			AgentNode.ROUTER,
		);
		expect(prose).toContain("plain prose");
		expect(prose).not.toContain("ran out of output space");

		expect(
			describeFailure(new Error("The model returned an empty response instead of the required JSON")),
		).toContain("output budget on reasoning");
	});

	it("explains provider timeouts", () => {
		const msg = describeFailure(
			new DOMException("The operation timed out.", "TimeoutError"),
			AgentNode.BLOCK_BUILDER,
		);
		expect(msg).toContain("took too long");
	});

	it("categorizes non-Error rejections without echoing them back", () => {
		// `{ code: 23 }`-shaped rejections still have to reach the right branch,
		// but the provider's own words never reach the user — they carry fragments
		// of the failing request, which here means prompt content.
		const msg = describeFailure({ code: "ETIMEDOUT" });
		expect(msg).toContain("took too long");
		expect(msg).not.toContain("ETIMEDOUT");
	});

	it("falls back to a generic explanation", () => {
		expect(describeFailure(new Error("boom"))).toContain("unexpected error");
	});
});

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

		constructor(private responses: AIMessage[]) {
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
			});
		}
	}

	const submitCall = (args: unknown, id = "call_1") =>
		new AIMessage({
			content: "",
			tool_calls: [{ id, name: SUBMIT_RESULT_TOOL, args: args as any }],
		});

	it("returns the tool arguments as the answer in a single model call", async () => {
		const wrapper = new LoopWrapper([submitCall({ blocks: ["a"] })]);
		expect(await wrapper.run()).toEqual({ blocks: ["a"] });
		// The whole point: no second generation of the same content.
		expect(wrapper.calls.length).toBe(1);
		expect(wrapper.boundTools.map((t) => t.name)).toContain(SUBMIT_RESULT_TOOL);
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

	it("accepts an answer written as free text without regenerating it", async () => {
		const wrapper = new LoopWrapper([new AIMessage('{"blocks":["a"]}')]);
		expect(await wrapper.run()).toEqual({ blocks: ["a"] });
		expect(wrapper.calls.length).toBe(1);
	});
});

describe("parallel tool calls", () => {
	let active = 0;
	let peak = 0;

	const slowTool = (name: string, output: string) =>
		tool(
			async () => {
				peak = Math.max(peak, ++active);
				await new Promise((r) => setTimeout(r, 10));
				active--;
				return output;
			},
			{ name, description: name, schema: z.object({}) },
		) as unknown as StructuredTool;

	class BatchWrapper extends BaseAgentWrapper {
		calls: BaseMessage[][] = [];

		constructor(private responses: AIMessage[]) {
			super("test-model");
		}

		protected createModel(): BaseChatModel {
			let i = 0;
			const model: any = {
				bindTools: () => model,
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
				tools: [slowTool("tool_a", "A"), slowTool("tool_b", "B")],
			});
		}
	}

	it("runs a batch concurrently and appends results in call order", async () => {
		active = 0;
		peak = 0;
		const wrapper = new BatchWrapper([
			new AIMessage({
				content: "",
				tool_calls: [
					{ id: "call_a", name: "tool_a", args: {} },
					{ id: "call_b", name: "tool_b", args: {} },
				],
			}),
			new AIMessage({
				content: "",
				tool_calls: [
					{ id: "call_s", name: SUBMIT_RESULT_TOOL, args: { blocks: ["a"] } },
				],
			}),
		]);

		expect(await wrapper.run()).toEqual({ blocks: ["a"] });
		// Both tools were in flight at the same time — the whole point.
		expect(peak).toBe(2);

		// Completion order must not leak into the history: a ToolMessage that
		// doesn't line up with its tool_call is rejected by strict providers.
		const second = wrapper.calls[1]!;
		const results = second.filter(
			(m): m is ToolMessage => m instanceof ToolMessage,
		);
		expect(results.map((m) => m.tool_call_id)).toEqual(["call_a", "call_b"]);
		expect(results.map((m) => String(m.content))).toEqual(["A", "B"]);
	});

	it("skips the rest of the batch when submit_result validates", async () => {
		active = 0;
		peak = 0;
		const wrapper = new BatchWrapper([
			new AIMessage({
				content: "",
				tool_calls: [
					{ id: "call_s", name: SUBMIT_RESULT_TOOL, args: { blocks: ["a"] } },
					{ id: "call_a", name: "tool_a", args: {} },
				],
			}),
		]);

		expect(await wrapper.run()).toEqual({ blocks: ["a"] });
		// The answer is in hand; running the rest is paid-for work nobody reads.
		expect(peak).toBe(0);
	});
});

describe("flattenToolMessages", () => {
	it("strips tool_use blocks and ends on a human turn", () => {
		// Anthropic and Mistral reject a request carrying tool_use blocks when no
		// tools are declared, and the structured-output fallback is unbound.
		const flat = flattenToolMessages([
			new HumanMessage("build it"),
			new AIMessage({
				content: "let me look",
				tool_calls: [{ id: "1", name: "find_resource", args: {} }],
			}),
			new ToolMessage({
				tool_call_id: "1",
				name: "find_resource",
				content: '{"routes":[]}',
			}),
		]);

		expect(flat.some((m) => (m as AIMessage).tool_calls?.length)).toBe(false);
		expect(flat.some((m) => m instanceof ToolMessage)).toBe(false);
		expect(flat.at(-1)!.getType()).toBe("human");
		// The findings themselves must survive — that's why the tools ran.
		expect(String(flat.at(-1)!.content)).toContain('{"routes":[]}');
		// Reasoning written alongside the call is kept.
		expect(flat.some((m) => m.content === "let me look")).toBe(true);
	});

	it("strips tool calls off an AIMessageChunk", () => {
		// AIMessageChunk implements AIMessage but extends BaseMessageChunk, so an
		// `instanceof AIMessage` gate misses a streamed reply entirely and its
		// tool calls ride into the unbound structured-output call.
		const flat = flattenToolMessages([
			new HumanMessage("build it"),
			new AIMessageChunk({
				content: "streamed reasoning",
				tool_calls: [{ id: "1", name: "get_block_schemas", args: {} }],
			}),
			new ToolMessage({
				tool_call_id: "1",
				name: "get_block_schemas",
				content: "### Custom Block: user_defined.project.validate_jwt",
			}),
		]);

		expect(flat.some((m) => (m as AIMessage).tool_calls?.length)).toBe(false);
		expect(flat.some((m) => m instanceof ToolMessage)).toBe(false);
		expect(flat.at(-1)!.getType()).toBe("human");
		expect(flat.some((m) => m.content === "streamed reasoning")).toBe(true);
	});

	it("strips tool calls an OpenAI-compatible provider left only in additional_kwargs", () => {
		// DeepSeek reports the call in `additional_kwargs` with `tool_calls`
		// empty. Keeping that message sends an assistant turn with tool calls and
		// no ToolMessage answering it — a 400 on every structured-output attempt.
		const flat = flattenToolMessages([
			new HumanMessage("build it"),
			new AIMessage({
				content: "checking the block",
				additional_kwargs: {
					tool_calls: [
						{
							id: "1",
							type: "function",
							function: { name: "get_block_schemas", arguments: "{}" },
						},
					],
				},
			}),
			new ToolMessage({
				tool_call_id: "1",
				name: "get_block_schemas",
				content: "### Custom Block: user_defined.project.validate_jwt",
			}),
		]);

		expect(
			flat.some((m) => Array.isArray(m.additional_kwargs?.tool_calls)),
		).toBe(false);
		expect(flat.some((m) => m instanceof ToolMessage)).toBe(false);
		expect(flat.at(-1)!.getType()).toBe("human");
		expect(flat.some((m) => m.content === "checking the block")).toBe(true);
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

describe("asHistoryMessage", () => {
	it("strips tool_calls before the message is re-sent with a human turn", () => {
		const response = new AIMessage({
			content: "here you go",
			tool_calls: [{ id: "call_1", name: "search_docs", args: {} }],
		});
		const out = asHistoryMessage(response, "here you go");
		expect(out.tool_calls ?? []).toHaveLength(0);
		expect(out.additional_kwargs?.tool_calls).toBeUndefined();
	});

	it("strips provider tool_calls carried in additional_kwargs", () => {
		const response = new AIMessage({
			content: "",
			additional_kwargs: {
				tool_calls: [
					{ id: "call_1", type: "function", function: { name: "x", arguments: "{}" } },
				],
				reasoning_content: "hm",
			},
		});
		const out = asHistoryMessage(response, "");
		expect(out.additional_kwargs?.tool_calls).toBeUndefined();
		expect(out.additional_kwargs?.reasoning_content).toBe("hm");
	});
});
