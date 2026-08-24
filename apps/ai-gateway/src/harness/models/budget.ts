import type { AIMessage } from "@langchain/core/messages";
import { logger } from "@fluxify/common";

/**
 * Wall-clock ceiling for one run. Retry budgets multiply: `withRetry` (3) x the
 * structured-output attempts (3) x `MODEL_CALL_TIMEOUT_MS` (3 min) means a
 * *single* agent call can legitimately burn 27 minutes, and a build runs dozens
 * of them. This is the backstop that a stuck run eventually hits.
 */
export const RUN_DEADLINE_MS = Number(
	process.env.HARNESS_RUN_DEADLINE_MS ?? 10 * 60_000,
);

/**
 * Token ceiling for one run. Sized well above a heavy multi-task build (~40
 * calls carrying the whole history) so it only ever catches a runaway loop, not
 * legitimate work. Providers that report no usage leave this unenforceable —
 * the deadline above still applies.
 */
export const RUN_TOKEN_BUDGET = Number(
	process.env.HARNESS_RUN_TOKEN_BUDGET ?? 2_000_000,
);

/** Thrown when a run passes its deadline or token ceiling. Not an interrupt:
 *  the run is finalized as `failed` with an explanation. */
export class RunBudgetExceededError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RunBudgetExceededError";
	}
}

/** Model spend attributable to one agent (or to the whole run). */
export interface AgentUsage {
	calls: number;
	/** Calls that had to be re-asked (bad structured output, transient network
	 *  errors). A healthy run is near zero; a rising number is the first sign an
	 *  agent's prompt or the chosen model is a bad fit. */
	retries: number;
	inputTokens: number;
	/** Estimated tokens from prior conversation history, tracked separately so
	 * the UI can show only work attributable to the current run. */
	historyInputTokens: number;
	outputTokens: number;
	/** Prompt tokens served from the provider's cache — the payoff of #148's
	 *  cache-friendly prompt ordering, and the only way to see it working. */
	cachedInputTokens: number;
	/** Time spent inside model calls. */
	modelMs: number;
}

export interface RunUsage extends AgentUsage {
	/** Actual tool executions requested by agents during this run. */
	toolCalls: number;
	totalTokens: number;
	/** Wall clock for the whole run, including graph and tool time. */
	elapsedMs: number;
	byAgent: Record<string, AgentUsage>;
}

function emptyUsage(): AgentUsage {
	return {
		calls: 0,
		retries: 0,
		inputTokens: 0,
		historyInputTokens: 0,
		outputTokens: 0,
		cachedInputTokens: 0,
		modelMs: 0,
	};
}

/**
 * Per-run deadline, token ceiling and usage accounting. One instance per run,
 * handed to the agent wrapper (which makes every model call) by the harness.
 */
export class RunBudget {
	private readonly startedAt = Date.now();
	private readonly deadlineMs: number;
	private readonly tokenBudget: number;
	private readonly total = emptyUsage();
	private readonly byAgent = new Map<string, AgentUsage>();

	constructor(options: { deadlineMs?: number; tokenBudget?: number } = {}) {
		this.deadlineMs = options.deadlineMs ?? RUN_DEADLINE_MS;
		this.tokenBudget = options.tokenBudget ?? RUN_TOKEN_BUDGET;
	}

	/** Milliseconds left before the deadline (negative once past it). */
	remainingMs(): number {
		return this.deadlineMs - (Date.now() - this.startedAt);
	}

	/** Throws once the run is out of time or tokens. Called before every model
	 *  call — a run only ever grows its spend by making one. */
	check(): void {
		if (this.deadlineMs > 0 && this.remainingMs() <= 0) {
			throw new RunBudgetExceededError(
				`Run budget exceeded: this request passed its ${Math.round(this.deadlineMs / 60_000)} minute time limit.`,
			);
		}
		const used = this.total.inputTokens + this.total.outputTokens;
		if (this.tokenBudget > 0 && used >= this.tokenBudget) {
			throw new RunBudgetExceededError(
				`Run budget exceeded: this request used ${used} tokens, above the ${this.tokenBudget} token limit.`,
			);
		}
	}

	private bucketFor(agentNode: string | undefined): AgentUsage {
		const agent = this.byAgent.get(agentNode ?? "unknown") ?? emptyUsage();
		this.byAgent.set(agentNode ?? "unknown", agent);
		return agent;
	}

	/** Books a re-ask against the run. Retries are the cost that hides: they are
	 *  already counted as calls, but nothing said they were the *same* call. */
	recordRetry(agentNode: string | undefined): void {
		this.total.retries += 1;
		this.bucketFor(agentNode).retries += 1;
	}

	/** Books one model call against the run and the agent that made it. */
	record(
		agentNode: string | undefined,
		response: unknown,
		modelMs: number,
		historyInputTokens = 0,
	): void {
		const usage = (response as AIMessage | undefined)?.usage_metadata;
		const agent = this.bucketFor(agentNode);

		for (const bucket of [this.total, agent]) {
			bucket.calls += 1;
			bucket.modelMs += modelMs;
			bucket.inputTokens += usage?.input_tokens ?? 0;
			bucket.historyInputTokens += usage ? historyInputTokens : 0;
			bucket.outputTokens += usage?.output_tokens ?? 0;
			bucket.cachedInputTokens += usage?.input_token_details?.cache_read ?? 0;
		}
	}

	snapshot(): RunUsage {
		return {
			...this.total,
			toolCalls: 0,
			totalTokens: this.total.inputTokens + this.total.outputTokens,
			elapsedMs: Date.now() - this.startedAt,
			byAgent: Object.fromEntries(this.byAgent),
		};
	}
}

/** Takes the run's final numbers and logs them, so a run's cost survives even
 *  if persisting it afterwards fails. Called once per run, on every terminal
 *  path. */
export function logRunUsage(
	ids: { runId: string; conversationId: string },
	budget: RunBudget,
	toolCalls = 0,
): RunUsage {
	const usage = { ...budget.snapshot(), toolCalls };
	logger.info("[FluxifyHarness] Run usage", { ...ids, ...usage });
	return usage;
}
