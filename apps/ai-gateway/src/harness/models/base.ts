import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	BaseMessage,
	SystemMessage,
	HumanMessage,
	AIMessage,
	ToolMessage,
} from "@langchain/core/messages";
import { Runnable, RunnableConfig } from "@langchain/core/runnables";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "@fluxify/common";
import { withRetry } from "../../lib/retry";
import { UserInterruptError } from "../errors";
import {
	summarizeToolResult,
	parseJsonLoose,
	describeSchemaError,
	extractText,
	cleanJsonOutput,
} from "./jsonUtils";

/** Upper bound for a single model/tool call. Long enough for big reasoning
 *  responses, short enough that a dead connection doesn't stall a run. */
export const MODEL_CALL_TIMEOUT_MS = 180_000; // 3 minutes

/** How many times the prompt-based structured-output path re-asks the model. */
const STRUCTURED_OUTPUT_ATTEMPTS = 3;

/** Near-greedy decoding for every harness call. These agents emit JSON and graph
 *  edits, not prose — sampling variance is pure error surface. */
export const HARNESS_TEMPERATURE = 0;

/** Output cap for every harness call. Agents emit JSON graph edits and short
 *  summaries; without a cap, a model that decides to narrate runs to the
 *  provider's own limit and burns the budget before it ever emits the payload. */
export const HARNESS_MAX_TOKENS = Number(
	process.env.HARNESS_MAX_TOKENS ?? 8192,
);

/** Successful connection probes, keyed per provider+model+credential.
 *  See `checkConnection`. */
const connectionProbeCache = new Map<string, number>();
const CONNECTION_PROBE_TTL_MS = 5 * 60_000;

/** Tool results older than this many tool turns are replaced with a one-line
 *  summary. The whole history is re-sent every iteration, so without this the
 *  first tool result is billed once per remaining turn. */
const VERBATIM_TOOL_RESULTS = 2;

/**
 * Replaces all but the most recent tool results with a one-line summary, in
 * place. The full history is re-sent on every tool iteration, so a fat result
 * from turn 1 is otherwise billed again on turns 2..n — the single biggest
 * source of token growth in a multi-tool run.
 *
 * The last {@link VERBATIM_TOOL_RESULTS} stay intact because those are what the
 * model is reasoning over right now. Older ones only need to record that the
 * call happened and roughly what came back. Compacted messages are marked so a
 * second pass doesn't summarise a summary.
 */
export function compactToolHistory(messages: BaseMessage[]): void {
	const toolIndexes: number[] = [];
	messages.forEach((m, i) => {
		if (m instanceof ToolMessage) toolIndexes.push(i);
	});

	for (const i of toolIndexes.slice(0, -VERBATIM_TOOL_RESULTS)) {
		const msg = messages[i] as ToolMessage;
		if (msg.additional_kwargs?.compacted) continue;
		const text = typeof msg.content === "string" ? msg.content : "";
		messages[i] = new ToolMessage({
			tool_call_id: msg.tool_call_id,
			name: msg.name,
			// summarizeToolResult only understands JSON; markdown tables and prose
			// fall back to a head slice.
			content: `[earlier result from ${msg.name ?? "tool"}, condensed] ${
				summarizeToolResult(text) ??
				(text.length > 300 ? `${text.slice(0, 300)}…` : text)
			}`,
			additional_kwargs: { ...msg.additional_kwargs, compacted: true },
		});
	}
}

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
	/** Task id when a sub-agent is calling — several instances of the same node
	 *  run concurrently, so events need it to stay attributable. */
	agentId?: string;
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
	private readonly connectionBaseUrl?: string;
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
	 * Publishes a tool-call event onto the graph's custom-event stream, where
	 * `HarnessCallbacks` turns it into a standard `executionType: "tool"` event.
	 * Never throws: outside a LangGraph run (unit tests, direct wrapper use)
	 * there is no callback context to dispatch into, and that must not fail the
	 * tool call itself.
	 */
	private async emitToolEvent(data: {
		agent?: string;
		agentId?: string;
		tool: string;
		status: "started" | "ended";
		summary?: string;
		error?: string;
	}): Promise<void> {
		try {
			await dispatchCustomEvent("tool_call", { ...data, agent: data.agent ?? "" });
		} catch {
			/* no run context — nothing to report to */
		}
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
		// Subclasses keep their own `baseUrl` (each SDK names the field
		// differently); this copy exists only to key the connection probe cache,
		// so two integrations pointing the same model at different servers don't
		// share a result.
		this.connectionBaseUrl = baseUrl;
	}

	// Each subclass implements this to return the initialized LangChain chat model
	protected abstract getModel(): BaseChatModel;

	/**
	 * Lightweight liveness probe — a tiny completion to confirm the provider,
	 * API key, and model are actually reachable before a full run. Throws on
	 * failure so callers can bail early with a meaningful message.
	 */
	public async checkConnection(): Promise<void> {
		// This runs before every run, so an uncached probe is a full RTT (plus
		// cold-connection TLS) added to every user request. Only successes are
		// cached — a failure must re-probe so a user who fixes their key isn't
		// locked out for the rest of the TTL.
		const key = `${this.constructor.name}:${this.modelName}:${this.connectionBaseUrl ?? ""}:${this.apiKey ?? ""}`;
		if ((connectionProbeCache.get(key) ?? 0) > Date.now()) return;

		await this.getModel().invoke([new HumanMessage("ping")], {
			timeout: 30_000,
		});
		connectionProbeCache.set(key, Date.now() + CONNECTION_PROBE_TTL_MS);
	}

	// Subclasses can override this if they don't natively support withStructuredOutput.
	protected supportsStructuredOutput(): boolean {
		return true;
	}

	/**
	 * Provider call options that force raw JSON output (OpenAI's
	 * `response_format: json_object`, Ollama's `format: "json"`, …), bound only on
	 * the prompt-based structured-output path. Constrained decoding is what stops
	 * a model from wrapping the payload in prose, `\boxed{}`, or escaped quotes —
	 * i.e. the things the parser was left guessing at. Undefined = unsupported.
	 */
	protected jsonModeOptions(): Record<string, any> | undefined {
		return undefined;
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
			agentId,
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

			const result = await this.runToolExecutionLoop<T>(
				model,
				finalMessages,
				tools,
				options,
			);
			if (result.done) return result.value;
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

	/**
	 * Runs the tool-call loop until the model stops calling tools or the
	 * iteration cap is hit. `finalMessages` is mutated in place so the caller's
	 * history stays in sync. Returns `{ done: true, value }` when the caller
	 * should return immediately (free-text answer with no schema); otherwise
	 * `{ done: false }` and `finalMessages` is ready for the structured-output
	 * step below.
	 */
	private async runToolExecutionLoop<T>(
		model: BaseChatModel,
		finalMessages: BaseMessage[],
		tools: StructuredTool[],
		options: AgentInvokeOptions,
	): Promise<{ done: true; value: T | AIMessage } | { done: false }> {
		const { zodSchema, config, agentNode, agentId } = options;
		const maxIterations =
			options.maxToolIterations ?? this.maxToolIterations ?? 8;

		for (let i = 0; i < maxIterations; i++) {
			this.throwIfInterrupted();
			compactToolHistory(finalMessages);
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
					await this.executeToolCall(tc, tools, finalMessages, {
						agent: agentNode,
						agentId,
						config,
					});
				}
				continue;
			}

			// No more tool calls — model produced its final answer.
			if (zodSchema) {
				// Drop the free-text message; the structured-output block
				// below will re-ask the base model for JSON.
				finalMessages.pop();
				return { done: false };
			}
			// Free-text answer is ready. Return it directly. Re-invoking the
			// model with this trailing assistant message makes providers like
			// Mistral reject the request with invalid_request_message_order
			// ("got assistant").
			return { done: true, value: response as T };
		}

		return { done: false };
	}

	/** Invokes a single tool call and pushes its result (or error) as a ToolMessage. */
	private async executeToolCall(
		tc: NonNullable<AIMessage["tool_calls"]>[number],
		tools: StructuredTool[],
		finalMessages: BaseMessage[],
		ctx: { agent?: string; agentId?: string; config?: RunnableConfig },
	): Promise<void> {
		const tool = tools.find((t) => t.name === tc.name);
		const toolEvent = { agent: ctx.agent, agentId: ctx.agentId, tool: tc.name };
		await this.emitToolEvent({ ...toolEvent, status: "started" });

		if (!tool) {
			finalMessages.push(
				new ToolMessage({
					tool_call_id: tc.id!,
					content: `Tool ${tc.name} not found.`,
					name: tc.name,
				}),
			);
			await this.emitToolEvent({
				...toolEvent,
				status: "ended",
				error: `tool ${tc.name} not found`,
			});
			return;
		}

		try {
			const toolResult = await tool.invoke(tc.args, this.withSignal(ctx.config));
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
			await this.emitToolEvent({
				...toolEvent,
				status: "ended",
				summary: summarizeToolResult(toolResult),
			});
		} catch (e) {
			finalMessages.push(
				new ToolMessage({
					tool_call_id: tc.id!,
					content: `Error executing tool ${tc.name}: ${e}`,
					name: tc.name,
				}),
			);
			await this.emitToolEvent({
				...toolEvent,
				status: "ended",
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}

	protected async fallbackStructuredOutput<T>(
		model: BaseChatModel | Runnable<any, any>,
		messages: BaseMessage[],
		schema: z.ZodType<any>,
		config?: RunnableConfig,
		agentNode?: string,
	): Promise<T> {
		// zod-to-json-schema (v3) reads zod v3 `_def` internals and silently emits
		// an empty schema against a zod v4 schema — the model then gets "match
		// this schema: {}" and guesses field names. zod v4 ships its own converter.
		const jsonSchema = z.toJSONSchema(schema, { target: "draft-7", io: "output" });

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

		// Constrained decoding where the provider offers it — far more reliable than
		// asking politely for "ONLY JSON" and then repairing the answer.
		const jsonMode = this.jsonModeOptions();
		let jsonModel =
			jsonMode && typeof (model as any).bind === "function"
				? (model as any).bind(jsonMode)
				: model;

		for (let attempt = 0; attempt < STRUCTURED_OUTPUT_ATTEMPTS; attempt++) {
			this.throwIfInterrupted();

			let content = "";
			let rawResponse: unknown;
			try {
				const response = await jsonModel.invoke(modifiedMessages, config);
				rawResponse = response;
				content = cleanJsonOutput(extractText(response));

				if (!content) {
					// Common with reasoning models that burn the whole output budget
					// on thinking, or answer with a tool call the unbound model can't place.
					throw new Error(
						"The model returned an empty response instead of the required JSON (it may have exhausted its output token budget).",
					);
				}

				return schema.parse(parseJsonLoose(content));
			} catch (error) {
				if (this.signal?.aborted) throw error;
				lastError = error;

				// Nothing came back at all, so the provider rejected the request
				// itself — usually an upstream that doesn't accept `response_format`
				// (some OpenRouter models, older compatible servers). Drop the
				// constraint rather than spending every attempt on the same 400.
				if (rawResponse === undefined && jsonModel !== model) {
					logger.warn("[BaseAgentWrapper] JSON mode rejected, dropping it", {
						model: this.modelName,
					});
					jsonModel = model;
				}

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
					this.asHistoryMessage(rawResponse, content),
					new HumanMessage(
						`Your previous response did not satisfy the required JSON schema.

Problem:
${describeSchemaError(error)}

Respond again with ONLY the corrected JSON object. Use the exact property names from the schema (do not rename or omit them), and include every required property — use an empty array for required arrays you have nothing to put in.`,
					),
				];
			}
		}

		throw new Error(
			`Failed to parse structured output after ${STRUCTURED_OUTPUT_ATTEMPTS} attempts. Error: ${describeSchemaError(lastError)}`,
		);
	}

	/**
	 * Feeds the model's own message back into the correction turn, rather than a
	 * fresh AIMessage built from the cleaned text. Reasoning models carry their
	 * thinking in content blocks or `additional_kwargs.reasoning_content`, and
	 * dropping it makes attempt 2 re-derive (and re-botch) the same answer.
	 */
	private asHistoryMessage(response: unknown, cleaned: string): AIMessage {
		const raw = response as
			| { content?: unknown; additional_kwargs?: Record<string, any> }
			| undefined;
		if (!raw) return new AIMessage(cleaned || "(empty response)");

		const hasContent =
			typeof raw.content === "string"
				? raw.content.trim() !== ""
				: Array.isArray(raw.content) && raw.content.length > 0;

		if (hasContent && response instanceof AIMessage) return response;

		return new AIMessage({
			content: hasContent
				? (raw.content as any)
				: extractText(raw as any) || "(empty response)",
			additional_kwargs: raw.additional_kwargs ?? {},
		});
	}

}
