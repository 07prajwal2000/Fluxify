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
import { logger } from "@fluxify/common";
import { withRetry } from "../../lib/retry";
import { UserInterruptError } from "../errors";

/** Upper bound for a single model/tool call. Long enough for big reasoning
 *  responses, short enough that a dead connection doesn't stall a run. */
export const MODEL_CALL_TIMEOUT_MS = 180_000; // 3 minutes

/** How many times the prompt-based structured-output path re-asks the model. */
const STRUCTURED_OUTPUT_ATTEMPTS = 3;

export interface AgentInvokeOptions {
	zodSchema?: z.ZodType<any>;
	userQuery?: string;
	systemPrompt?: string;
	messages?: BaseMessage[];
	tools?: StructuredTool[];
	config?: RunnableConfig;
	maxToolIterations?: number;
	/** Which graph node is calling (e.g. `AgentNode.PLANNER`) — plain string so
	 *  this provider-agnostic layer doesn't depend on the graph's node enum.
	 *  Threaded into retry-warning events so the UI can attribute them. */
	agentNode?: string;
}

/** A retryable error a caller may want to surface live (e.g. as a socket
 *  event) instead of only finding out once the run finishes or fails. */
export interface RetryWarningInfo {
	agentNode?: string;
	attempt: number;
	maxAttempts: number;
	rawError: string;
}

export abstract class BaseAgentWrapper {
	protected modelName: string;
	protected apiKey?: string;
	protected additionalHeaders?: Record<string, string>;
	protected maxToolIterations?: number;
	/** Set per run by the harness; when aborted, every model call is cancelled and
	 *  a UserInterruptError is raised. */
	protected signal?: AbortSignal;
	/** Set per run by the harness — lets retryable errors (bad structured output,
	 *  transient network issues) be surfaced live instead of only on failure. */
	private retryWarningSink?: (info: RetryWarningInfo) => void;

	/** Wires the run's interrupt signal into this agent (called once per run). */
	public setAbortSignal(signal: AbortSignal): void {
		this.signal = signal;
	}

	/** Wires a live retry-warning sink into this agent (called once per run). */
	public setRetryWarningSink(sink: (info: RetryWarningInfo) => void): void {
		this.retryWarningSink = sink;
	}

	private emitRetryWarning(
		agentNode: string | undefined,
		attempt: number,
		maxAttempts: number,
		error: unknown,
	): void {
		this.retryWarningSink?.({
			agentNode,
			attempt,
			maxAttempts,
			rawError: error instanceof Error ? error.message : String(error),
		});
	}

	/**
	 * Merges the run's abort signal and a per-call timeout into an invoke config.
	 * Without an explicit timeout a stuck provider connection hangs the whole run
	 * until some outer layer gives up; bounded here so withRetry can retry it.
	 */
	private withSignal(config?: RunnableConfig): RunnableConfig {
		return {
			timeout: MODEL_CALL_TIMEOUT_MS,
			...config,
			...(this.signal ? { signal: this.signal } : {}),
		};
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
		await this.getModel().invoke([new HumanMessage("ping")], {
			timeout: 30_000,
		});
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
			agentNode,
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
			const maxIterations =
				options.maxToolIterations ?? this.maxToolIterations ?? 15;
			for (let i = 0; i < maxIterations; i++) {
				this.throwIfInterrupted();
				// Retried like every other model call — a single network timeout
				// mid-loop used to kill the whole run.
				const response = (await withRetry(
					() => model.invoke(finalMessages, this.withSignal(config)),
					{
						maxRetries: 2,
						signal: this.signal,
						onRetry: (attempt, max, err) =>
							this.emitRetryWarning(agentNode, attempt, max, err),
					},
				)) as AIMessage;
				finalMessages.push(response);

				if (response.tool_calls && response.tool_calls.length > 0) {
					for (const tc of response.tool_calls) {
						const tool = tools.find((t) => t.name === tc.name);
						if (tool) {
							try {
								const toolResult = await tool.invoke(
									tc.args,
									this.withSignal(config),
								);
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
			if (
				this.supportsStructuredOutput() &&
				originalModel.withStructuredOutput
			) {
				const structuredModel = originalModel.withStructuredOutput(zodSchema);
				try {
					// By using invoke with config, it automatically logs to LangSmith/Langfuse
					result = await withRetry(
						() =>
							structuredModel.invoke(
								finalMessages,
								this.withSignal(config),
							) as Promise<T>,
						{
							maxRetries: 3,
							signal: this.signal,
							onRetry: (attempt, max, err) =>
								this.emitRetryWarning(agentNode, attempt, max, err),
						},
					);
				} catch (e) {
					// Native structured output can fail outright (unsupported schema
					// features, provider quirks). Fall through to the prompt-based
					// fallback below rather than killing the run.
					this.throwIfInterrupted();
					logger.warn(
						"[BaseAgentWrapper] Native structured output failed, using prompt fallback",
						{
							model: this.modelName,
							error: e instanceof Error ? e.message : String(e),
						},
					);
				}
			}

			if (!result) {
				// Fallback implementation for models that don't support withStructuredOutput natively,
				// or if the native method failed silently (common with some model wrappers on complex inputs).
				// It retries internally, feeding the validation error back to the model.
				result = (await this.fallbackStructuredOutput(
					originalModel,
					finalMessages,
					zodSchema,
					this.withSignal(config),
					agentNode,
				)) as T;
			}

			if (!result) {
				throw new Error(
					"Failed to get structured output from the model (it may have exceeded tool call limits without producing a JSON result).",
				);
			}
			return result;
		}

		return await withRetry(
			() => originalModel.invoke(finalMessages, this.withSignal(config)),
			{
				maxRetries: 3,
				signal: this.signal,
				onRetry: (attempt, max, err) =>
					this.emitRetryWarning(agentNode, attempt, max, err),
			},
		);
	}

	protected async fallbackStructuredOutput<T>(
		model: BaseChatModel | Runnable<any, any>,
		messages: BaseMessage[],
		schema: z.ZodType<any>,
		config?: RunnableConfig,
		agentNode?: string,
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

		// Self-correcting loop: a blind retry just makes the model repeat the same
		// mistake, so each attempt shows it what it got back and what was wrong.
		// The correction is a human turn — a trailing system/assistant message makes
		// providers like Mistral reject the request outright.
		let lastError: unknown;

		for (let attempt = 0; attempt < STRUCTURED_OUTPUT_ATTEMPTS; attempt++) {
			this.throwIfInterrupted();

			let content = "";
			try {
				const response = await model.invoke(modifiedMessages, config);
				content = this.cleanJsonOutput(this.extractText(response));

				if (!content) {
					// Common with reasoning models that burn the whole output budget
					// on thinking, or answer with a tool call the unbound model can't place.
					throw new Error(
						"The model returned an empty response instead of the required JSON (it may have exhausted its output token budget).",
					);
				}

				// `"field": null` for an omitted optional field is the single most
				// common drift; drop nulls so optional() accepts them.
				return schema.parse(
					JSON.parse(content, (_key, value) =>
						value === null ? undefined : value,
					),
				);
			} catch (error) {
				if (this.signal?.aborted) throw error;
				lastError = error;
				if (attempt === STRUCTURED_OUTPUT_ATTEMPTS - 1) break;

				logger.warn("[BaseAgentWrapper] Structured output invalid, re-asking", {
					model: this.modelName,
					attempt: attempt + 1,
					error: error instanceof Error ? error.message : String(error),
				});
				this.emitRetryWarning(
					agentNode,
					attempt + 1,
					STRUCTURED_OUTPUT_ATTEMPTS,
					error,
				);

				modifiedMessages = [
					...modifiedMessages,
					new AIMessage(content || "(empty response)"),
					new HumanMessage(
						`Your previous response did not satisfy the required JSON schema.

Problem:
${this.describeSchemaError(error)}

Respond again with ONLY the corrected JSON object. Use the exact property names from the schema (do not rename or omit them), and include every required property — use an empty array for required arrays you have nothing to put in.`,
					),
				];
			}
		}

		throw new Error(
			`Failed to parse structured output after ${STRUCTURED_OUTPUT_ATTEMPTS} attempts. Error: ${this.describeSchemaError(lastError)}`,
		);
	}

	/** Compact, model-readable description of a zod or JSON parse failure. */
	private describeSchemaError(error: unknown): string {
		const issues = (error as any)?.issues;
		if (Array.isArray(issues)) {
			return issues
				.slice(0, 20)
				.map(
					(i: any) => `- ${(i.path ?? []).join(".") || "(root)"}: ${i.message}`,
				)
				.join("\n");
		}
		const message = error instanceof Error ? error.message : String(error);
		return message.slice(0, 500);
	}

	/**
	 * Flattens a model response to plain text. Content can be a string, an array
	 * of content blocks (Anthropic/Google/reasoning models), or empty with the
	 * real text parked in a provider-specific `reasoning_content` field.
	 */
	protected extractText(response: {
		content: unknown;
		additional_kwargs?: Record<string, any>;
	}): string {
		const { content } = response;
		let text = "";

		if (typeof content === "string") {
			text = content;
		} else if (Array.isArray(content)) {
			text = content
				.map((block: any) =>
					typeof block === "string" ? block : (block?.text ?? ""),
				)
				.join("");
		}

		if (!text.trim()) {
			const reasoning = response.additional_kwargs?.reasoning_content;
			if (typeof reasoning === "string") text = reasoning;
		}

		return text;
	}

	protected cleanJsonOutput(content: string): string {
		// Remove <think>...</think> blocks from deepseek or reasoning models
		content = content.replace(/<think>[\s\S]*?<\/think>/g, "");

		// Remove markdown code blocks if present
		const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (codeBlockMatch && codeBlockMatch[1]) {
			content = codeBlockMatch[1];
		}

		content = content.trim();

		// Strip any prose wrapped around the payload (e.g. "Here is the JSON: {...}").
		const start = content.search(/[{[]/);
		if (start > 0) {
			const end = Math.max(content.lastIndexOf("}"), content.lastIndexOf("]"));
			if (end > start) content = content.slice(start, end + 1);
		}

		return content.trim();
	}
}
