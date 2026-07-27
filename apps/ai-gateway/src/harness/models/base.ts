import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	BaseMessage,
	SystemMessage,
	HumanMessage,
	AIMessage,
	ToolMessage,
} from "@langchain/core/messages";
import { Runnable, RunnableConfig } from "@langchain/core/runnables";
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { withRetry } from "../../lib/retry";
import { UserInterruptError } from "../errors";

export interface AgentInvokeOptions {
	zodSchema?: z.ZodType<any>;
	userQuery?: string;
	systemPrompt?: string;
	messages?: BaseMessage[];
	tools?: StructuredTool[];
	config?: RunnableConfig;
	maxToolIterations?: number;
}

export abstract class BaseAgentWrapper {
	protected modelName: string;
	protected apiKey?: string;
	protected additionalHeaders?: Record<string, string>;
	protected maxToolIterations?: number;
	/** Set per run by the harness; when aborted, every model call is cancelled and
	 *  a UserInterruptError is raised. */
	protected signal?: AbortSignal;

	/** Wires the run's interrupt signal into this agent (called once per run). */
	public setAbortSignal(signal: AbortSignal): void {
		this.signal = signal;
	}

	/** Merges the run's abort signal into a model-invoke config. */
	private withSignal(config?: RunnableConfig): RunnableConfig {
		return this.signal ? { ...config, signal: this.signal } : (config ?? {});
	}

	/** Raises a UserInterruptError if the run has been interrupted. */
	private throwIfInterrupted(): void {
		if (this.signal?.aborted) throw new UserInterruptError();
	}

	constructor(
		modelName: string,
		apiKey?: string,
		additionalHeaders?: Record<string, string>,
		baseUrl?: string,
		maxToolIterations?: number,
	) {
		this.modelName = modelName;
		this.apiKey = apiKey;
		this.additionalHeaders = additionalHeaders;
		this.maxToolIterations = maxToolIterations;
	}

	// Each subclass implements this to return the initialized LangChain chat model
	protected abstract getModel(): BaseChatModel;

	/**
	 * Lightweight liveness probe — a tiny completion to confirm the provider,
	 * API key, and model are actually reachable before a full run. Throws on
	 * failure so callers can bail early with a meaningful message.
	 */
	public async checkConnection(): Promise<void> {
		await this.getModel().invoke([new HumanMessage("ping")]);
	}

	// Subclasses can override this if they don't natively support withStructuredOutput.
	protected supportsStructuredOutput(): boolean {
		return true;
	}

	public async invokeAgent<T = any>(
		options: AgentInvokeOptions,
	): Promise<T | AIMessage> {
		try {
			return await this.invokeAgentInner<T>(options);
		} catch (error) {
			// Normalize any underlying abort into a single interrupt error so the
			// graph's top-level catch handles it uniformly.
			if (this.signal?.aborted) throw new UserInterruptError();
			throw error;
		}
	}

	private async invokeAgentInner<T = any>(
		options: AgentInvokeOptions,
	): Promise<T | AIMessage> {
		this.throwIfInterrupted();
		const {
			zodSchema,
			userQuery,
			systemPrompt,
			messages = [],
			tools,
			config,
		} = options;

		let finalMessages: BaseMessage[] = [...messages];

		if (systemPrompt && !finalMessages.some((m) => m.type === "system")) {
			finalMessages.unshift(new SystemMessage(systemPrompt));
		}

		if (userQuery) {
			finalMessages.push(new HumanMessage(userQuery));
		}

		let model = this.getModel();
		const originalModel = model;

		if (tools && tools.length > 0) {
			if (model.bindTools) {
				model = model.bindTools(tools) as any;
			}

			// Tool execution loop
			const maxIterations = options.maxToolIterations ?? this.maxToolIterations ?? 15;
			for (let i = 0; i < maxIterations; i++) {
				this.throwIfInterrupted();
				const response = (await model.invoke(
					finalMessages,
					this.withSignal(config),
				)) as AIMessage;
				finalMessages.push(response);

				if (response.tool_calls && response.tool_calls.length > 0) {
					for (const tc of response.tool_calls) {
						const tool = tools.find((t) => t.name === tc.name);
						if (tool) {
							try {
								const toolResult = await tool.invoke(tc.args, this.withSignal(config));
								finalMessages.push(
									new ToolMessage({
										tool_call_id: tc.id!,
										content:
											typeof toolResult === "string"
												? toolResult
												: JSON.stringify(toolResult),
										name: tc.name,
									}),
								);
							} catch (e) {
								finalMessages.push(
									new ToolMessage({
										tool_call_id: tc.id!,
										content: `Error executing tool ${tc.name}: ${e}`,
										name: tc.name,
									}),
								);
							}
						} else {
							finalMessages.push(
								new ToolMessage({
									tool_call_id: tc.id!,
									content: `Tool ${tc.name} not found.`,
									name: tc.name,
								}),
							);
						}
					}
				} else {
					// No more tool calls — model produced its final answer.
					if (zodSchema) {
						// Drop the free-text message; the structured-output block
						// below will re-ask the base model for JSON.
						finalMessages.pop();
						break;
					}
					// Free-text answer is ready. Return it directly. Re-invoking
					// the model (line below) with this trailing assistant message
					// makes providers like Mistral reject the request with
					// invalid_request_message_order ("got assistant").
					return response as T;
				}
			}
		}

		if (zodSchema) {
			let result: any;
			if (this.supportsStructuredOutput() && originalModel.withStructuredOutput) {
				const structuredModel = originalModel.withStructuredOutput(zodSchema);
				// By using invoke with config, it automatically logs to LangSmith/Langfuse
				result = await withRetry(
					() =>
						structuredModel.invoke(finalMessages, this.withSignal(config)) as Promise<T>,
					{ maxRetries: 3, signal: this.signal },
				);
			}

			if (!result) {
				// Fallback implementation for models that don't support withStructuredOutput natively,
				// or if the native method failed silently (common with some model wrappers on complex inputs)
				result = await withRetry(
					() =>
						this.fallbackStructuredOutput(
							originalModel,
							finalMessages,
							zodSchema,
							this.withSignal(config),
						) as Promise<T>,
					{ maxRetries: 3, signal: this.signal },
				);
			}

			if (!result) {
				throw new Error("Failed to get structured output from the model (it may have exceeded tool call limits without producing a JSON result).");
			}
			return result;
		}

		return await withRetry(
			() => originalModel.invoke(finalMessages, this.withSignal(config)),
			{ maxRetries: 3, signal: this.signal },
		);
	}

	protected async fallbackStructuredOutput<T>(
		model: BaseChatModel | Runnable<any, any>,
		messages: BaseMessage[],
		schema: z.ZodType<any>,
		config?: RunnableConfig,
	): Promise<T> {
		const jsonSchema = zodToJsonSchema(schema as any);

		const formatInstructions = `
You must respond with ONLY a valid JSON object matching the following JSON schema. 
Do not include any markdown formatting (like \`\`\`json) or <think> tags in your final JSON output.
Your output will be parsed directly by JSON.parse().

Schema:
${JSON.stringify(jsonSchema, null, 2)}
`;

		let modifiedMessages = [...messages];
		const systemMessageIndex = modifiedMessages.findIndex(
			(m) => m.type === "system",
		);

		if (systemMessageIndex >= 0) {
			const existingSystem = modifiedMessages[systemMessageIndex].content;
			modifiedMessages[systemMessageIndex] = new SystemMessage(
				`${existingSystem}\n\n${formatInstructions}`,
			);
		} else {
			modifiedMessages.unshift(new SystemMessage(formatInstructions));
		}

		const response = await model.invoke(modifiedMessages, config);
		let content = response.content as string;

		content = this.cleanJsonOutput(content);

		try {
			const parsed = JSON.parse(content);
			return schema.parse(parsed);
		} catch (error) {
			throw new Error(
				`Failed to parse structured output. Model response: ${content}. Error: ${error}`,
			);
		}
	}

	protected cleanJsonOutput(content: string): string {
		// Remove <think>...</think> blocks from deepseek or reasoning models
		content = content.replace(/<think>[\s\S]*?<\/think>/g, "");

		// Remove markdown code blocks if present
		const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (codeBlockMatch && codeBlockMatch[1]) {
			content = codeBlockMatch[1];
		}

		return content.trim();
	}
}
