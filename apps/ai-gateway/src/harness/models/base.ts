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
import { UserInterruptError, isCallTimeout } from "../errors";
import {
	summarizeToolResult,
	parseJsonLoose,
	describeSchemaError,
	extractText,
	cleanJsonOutput,
} from "./jsonUtils";
import {
	SUBMIT_RESULT_TOOL,
	SUBMIT_RESULT_INSTRUCTION,
	asHistoryMessage,
	compactToolHistory,
	debugPrompt,
	flattenToolMessages,
	makeSubmitResultTool,
	parseAsSchema,
} from "./toolLoop";
import type { RunBudget } from "./budget";
import { UNTRUSTED_DATA_RULE } from "../internal/untrusted";

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

export interface AgentInvokeOptions {
	zodSchema?: z.ZodType<any>;
	userQuery?: string;
	systemPrompt?: string;
	/** Per-run volatile context (scratchpad notes, the "Current context" block).
	 *  It belongs here rather than concatenated onto `systemPrompt`: a system
	 *  prompt that changes per run can never be a cached prefix, and providers
	 *  cache by byte-identical prefix. Sent as part of the trailing human turn,
	 *  ahead of `userQuery`. */
	context?: string;
	messages?: BaseMessage[];
	/** Leading entries in `messages` loaded from earlier conversation turns. */
	historyMessageCount?: number;
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
	/** Set per run by the harness. Every model call is booked against it and
	 *  checked against it — this class is the only place they happen. */
	private budget?: RunBudget;

	/** Wires the run's interrupt signal into this agent (called once per run). */
	public setAbortSignal(signal: AbortSignal): void {
		this.signal = signal;
	}

	/** Wires the run's deadline/token budget into this agent (once per run). */
	public setRunBudget(budget: RunBudget): void {
		this.budget = budget;
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
		// A call that would outlive the run's deadline is wasted spend — the run
		// fails the moment it returns. Never below 1s: ensureConfig rejects a
		// non-positive timeout, and `checkRunLimits` has already thrown by then.
		const remaining = this.budget?.remainingMs() ?? MODEL_CALL_TIMEOUT_MS;
		return {
			timeout: Math.max(1_000, Math.min(MODEL_CALL_TIMEOUT_MS, remaining)),
			...config,
			...(this.signal ? { signal: this.signal } : {}),
		};
	}

	/** Raises before a model call the run can't afford: a UserInterruptError if
	 *  the user stopped it, a RunBudgetExceededError if it is out of time or
	 *  tokens. */
	private checkRunLimits(): void {
		if (this.signal?.aborted) throw new UserInterruptError();
		this.budget?.check();
	}

	/** Books a completed model call against the run budget. `response` is an
	 *  AIMessage on every path; anything without `usage_metadata` (compatible
	 *  servers that don't report it) still counts as a call. */
	private recordUsage(
		agentNode: string | undefined,
		response: unknown,
		startedAt: number,
		historyInputTokens = 0,
	): void {
		this.budget?.record(
			agentNode,
			response,
			Date.now() - startedAt,
			historyInputTokens,
		);
	}

	/** Provider usage metadata has no history/current-run split. Estimate only
	 * conversation-history text; provider-reported output tokens stay exact. */
	private estimateHistoryTokens(messages: BaseMessage[], count: number): number {
		return messages.slice(0, Math.max(0, count)).reduce((total, message) => {
			const content = typeof message.content === "string"
				? message.content
				: JSON.stringify(message.content);
			return total + Math.ceil(content.length / 4);
		}, 0);
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
	protected abstract createModel(): BaseChatModel;

	/** The model is immutable for the life of a wrapper (one wrapper per run), yet
	 *  every invokeAgent used to construct a fresh SDK client — and throw away its
	 *  connection pool with it. Built once, on first use. */
	protected getModel(): BaseChatModel {
		this.model ??= this.createModel();
		return this.model;
	}
	private model?: BaseChatModel;

	/**
	 * Wraps the system prompt in a provider-native message. Anthropic overrides
	 * this to attach a cache breakpoint; everyone else gets a plain string.
	 */
	protected buildSystemMessage(text: string): SystemMessage {
		return new SystemMessage(text);
	}

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
		this.checkRunLimits();
		const {
			zodSchema,
			userQuery,
			systemPrompt,
			context,
			messages = [],
			historyMessageCount = 0,
			tools,
			config,
			agentNode,
			agentId,
		} = options;

		let finalMessages: BaseMessage[] = [...messages];
		const historyInputTokens = this.estimateHistoryTokens(
			messages,
			historyMessageCount,
		);

		// A tool-using agent returns its answer through `submit_result` instead of
		// writing it out and having it regenerated as JSON afterwards.
		const submitTool =
			zodSchema && tools && tools.length > 0
				? makeSubmitResultTool(zodSchema)
				: undefined;

		if (systemPrompt && !finalMessages.some((m) => m.type === "system")) {
			// The untrusted-content rule is appended unconditionally, not only for
			// tool-using agents: fenced content also arrives through `context`, and
			// a rule that comes and goes would vary the cached system prefix.
			const suffix = [
				UNTRUSTED_DATA_RULE,
				submitTool ? SUBMIT_RESULT_INSTRUCTION : undefined,
			].filter(Boolean);
			finalMessages.unshift(
				this.buildSystemMessage([systemPrompt, ...suffix].join("\n\n")),
			);
		}

		// Volatile context rides with the user's turn, not the system prompt, so
		// the prefix ahead of it stays byte-identical across runs and can be
		// served from the provider's cache. Being last is also where a model
		// reads it most reliably.
		if (userQuery || context) {
			finalMessages.push(
				new HumanMessage([context, userQuery].filter(Boolean).join("\n\n")),
			);
		}

		let model = this.getModel();
		const originalModel = model;

		if (tools && tools.length > 0) {
			const boundTools = submitTool ? [...tools, submitTool] : tools;
			if (model.bindTools) {
				model = model.bindTools(boundTools) as any;
			}

			const result = await this.runToolExecutionLoop<T>(
				model,
				finalMessages,
				tools,
				options,
				historyInputTokens,
			);
			if (result.done) return result.value;

			// Everything below invokes the unbound model, which cannot be sent
			// `tool_use` blocks.
			finalMessages = flattenToolMessages(finalMessages);
		}

		if (zodSchema) {
			let result: any;
			if (
				this.supportsStructuredOutput() &&
				originalModel.withStructuredOutput
			) {
				// `includeRaw` keeps the underlying AIMessage, which is the only place
				// this path's token usage exists — without it the natively-structured
				// calls (a whole provider family) are invisible to the budget.
				const structuredModel = originalModel.withStructuredOutput(zodSchema, {
					includeRaw: true,
				});
				try {
					// By using invoke with config, it automatically logs to LangSmith/Langfuse
					result = await withRetry(
						async () => {
							const startedAt = Date.now();
							const { raw, parsed, parsingError } =
								(await structuredModel.invoke(
									finalMessages,
									this.withSignal(config),
								)) as { raw: AIMessage; parsed: T; parsingError?: Error };
							this.recordUsage(agentNode, raw, startedAt, historyInputTokens);
							// Without includeRaw this would have thrown out of `invoke`;
							// rethrow so the retry and the prompt fallback below still see it.
							if (parsingError) throw parsingError;
							return parsed;
						},
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
					// fallback below rather than killing the run. A budget failure is
					// not a provider quirk, though — `checkRunLimits` rethrows it.
					this.checkRunLimits();
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
					historyInputTokens,
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
			async () => {
				const startedAt = Date.now();
				const response = await originalModel.invoke(
					finalMessages,
					this.withSignal(config),
				);
				this.recordUsage(agentNode, response, startedAt, historyInputTokens);
				return response;
			},
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
		historyInputTokens: number,
	): Promise<{ done: true; value: T | AIMessage } | { done: false }> {
		const { zodSchema, config, agentNode, agentId } = options;
		const maxIterations =
			options.maxToolIterations ?? this.maxToolIterations ?? 8;

		for (let i = 0; i < maxIterations; i++) {
			this.checkRunLimits();
			compactToolHistory(finalMessages);
			// Retried like every other model call — a single network timeout
			// mid-loop used to kill the whole run.
			const response = (await withRetry(
				async () => {
					const startedAt = Date.now();
					debugPrompt(agentNode, finalMessages);
					const message = await model.invoke(
						finalMessages,
						this.withSignal(config),
					);
					this.recordUsage(agentNode, message, startedAt, historyInputTokens);
					return message;
				},
				{
					maxRetries: 2,
					signal: this.signal,
					onRetry: (attempt, max, err) =>
						this.emitRetryWarning(agentNode, attempt, max, err),
				},
			)) as AIMessage;
			finalMessages.push(response);

			if (response.tool_calls && response.tool_calls.length > 0) {
				// `submit_result` is the answer, not work — if it validates, nothing
				// else the model asked for in this batch is worth running.
				const submit = zodSchema
					? response.tool_calls.find((tc) => tc.name === SUBMIT_RESULT_TOOL)
					: undefined;
				const submitParsed = submit && zodSchema?.safeParse(submit.args);
				if (submitParsed?.success)
					return { done: true, value: submitParsed.data as T };

				// Models emit parallel tool calls precisely so they can run in
				// parallel; running them in sequence costs the sum of the round
				// trips instead of the max. Results are pushed in call order, not
				// completion order — strict providers reject a batch whose
				// ToolMessages don't line up with their tool_calls.
				const results = await Promise.all(
					response.tool_calls.map((tc) => {
						if (submitParsed && !submitParsed.success && tc === submit) {
							// Answer the call so the history stays valid (a tool_call with
							// no result is rejected outright) and let the model correct
							// itself on the next iteration.
							return new ToolMessage({
								tool_call_id: tc.id!,
								name: tc.name,
								content: `Rejected — the result did not match the required schema.\n\n${describeSchemaError(submitParsed.error)}\n\nCall ${SUBMIT_RESULT_TOOL} again with the corrected values.`,
							});
						}
						return this.executeToolCall(tc, tools, {
							agent: agentNode,
							agentId,
							config,
						});
					}),
				);
				finalMessages.push(...results);
				continue;
			}

			// No more tool calls — model produced its final answer.
			if (zodSchema) {
				// It may have written the JSON out as text instead of calling
				// submit_result. Parse it before paying to regenerate the same
				// content; only fall through to the structured-output step if it
				// really isn't the answer.
				const parsed = parseAsSchema<T>(zodSchema, extractText(response));
				if (parsed !== undefined) return { done: true, value: parsed };

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

	/**
	 * Invokes a single tool call and returns its result (or error) as a
	 * ToolMessage. It returns rather than appending so a batch can run
	 * concurrently and still be appended in call order.
	 */
	private async executeToolCall(
		tc: NonNullable<AIMessage["tool_calls"]>[number],
		tools: StructuredTool[],
		ctx: { agent?: string; agentId?: string; config?: RunnableConfig },
	): Promise<ToolMessage> {
		const tool = tools.find((t) => t.name === tc.name);
		const toolEvent = { agent: ctx.agent, agentId: ctx.agentId, tool: tc.name };
		await this.emitToolEvent({ ...toolEvent, status: "started" });

		if (!tool) {
			await this.emitToolEvent({
				...toolEvent,
				status: "ended",
				error: `tool ${tc.name} not found`,
			});
			return new ToolMessage({
				tool_call_id: tc.id!,
				content: `Tool ${tc.name} not found.`,
				name: tc.name,
			});
		}

		try {
			const toolResult = await tool.invoke(tc.args, this.withSignal(ctx.config));
			await this.emitToolEvent({
				...toolEvent,
				status: "ended",
				summary: summarizeToolResult(toolResult),
			});
			return new ToolMessage({
				tool_call_id: tc.id!,
				content:
					typeof toolResult === "string"
						? toolResult
						: JSON.stringify(toolResult),
				name: tc.name,
			});
		} catch (e) {
			await this.emitToolEvent({
				...toolEvent,
				status: "ended",
				error: e instanceof Error ? e.message : String(e),
			});
			return new ToolMessage({
				tool_call_id: tc.id!,
				content: `Error executing tool ${tc.name}: ${e}`,
				name: tc.name,
			});
		}
	}

	protected async fallbackStructuredOutput<T>(
		model: BaseChatModel | Runnable<any, any>,
		messages: BaseMessage[],
		schema: z.ZodType<any>,
		config?: RunnableConfig,
		agentNode?: string,
		historyInputTokens = 0,
	): Promise<T> {
		// zod-to-json-schema (v3) reads zod v3 `_def` internals and silently emits
		// an empty schema against a zod v4 schema — the model then gets "match
		// this schema: {}" and guesses field names. zod v4 ships its own converter.
		const jsonSchema = z.toJSONSchema(schema, { target: "draft-7", io: "output" });

		const formatInstructions = `You must respond with ONLY a valid JSON object matching the following JSON schema.
Do not include any markdown formatting (like \`\`\`json) or <think> tags in your final JSON output.
Do not explain your answer in prose — the JSON object IS the answer.
Your output will be parsed directly by JSON.parse().

Schema:
${JSON.stringify(jsonSchema, null, 2)}`;

		// The contract goes in the LAST turn, not appended to the system prompt.
		// Buried behind a long system prompt plus history, providers that ignore
		// `response_format` (Poolside, some compatible servers) answer the user's
		// question in prose and the first attempt is spent discovering that — the
		// correction turn then works purely because it is the last thing read.
		// A trailing human turn keeps the history provider-valid (see the
		// `invalid_request_message_order` rules in AGENT.md).
		let modifiedMessages = [...messages, new HumanMessage(formatInstructions)];

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
			this.checkRunLimits();

			let content = "";
			let rawResponse: unknown;
			try {
				const startedAt = Date.now();
				const response = await jsonModel.invoke(modifiedMessages, config);
				this.recordUsage(agentNode, response, startedAt, historyInputTokens);
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
				// A call that timed out produced no output to correct. Re-asking just
				// spends another full MODEL_CALL_TIMEOUT_MS on a provider that is
				// already too slow, and the run dies on its deadline instead of
				// reporting the real reason.
				if (isCallTimeout(error)) throw error;
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
					asHistoryMessage(rawResponse, content),
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

}
