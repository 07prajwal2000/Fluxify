import { trace, context, type Span } from "@fluxify/common/tracing";
import type { RunUsage } from "../models/budget";

/**
 * The one span that covers a whole harness run, from graph start to the
 * persisted outcome.
 *
 * `FluxifyOtelTracer` traces individual chains, LLM calls and tools, but every
 * one of those spans ends while the graph is still streaming — there is nowhere
 * to hang what a *run* cost, why it failed, or how often it had to re-ask. This
 * is that place, and because it is made the active span, all of the tracer's
 * spans nest underneath it.
 *
 * Attributes follow the OpenInference conventions (`llm.token_count.*`) so
 * Phoenix/Arize read them without a mapping, plus `fluxify.run.*` for what is
 * ours alone.
 */
export function startRunSpan(input: {
	runId: string;
	conversationId: string;
	projectId?: string;
	userQuery?: string;
}): Span {
	const span = trace.getTracer("fluxify-harness").startSpan("harness.run", {
		attributes: {
			"openinference.span.kind": "AGENT",
			"fluxify.run.id": input.runId,
			"fluxify.conversation.id": input.conversationId,
			...(input.projectId ? { "fluxify.project.id": input.projectId } : {}),
			...(input.userQuery ? { "input.value": input.userQuery } : {}),
		},
	});
	return span;
}

/** Runs `fn` with the run span active, so spans created inside it nest under
 *  the run instead of dangling at the trace root. */
export function withRunSpan<T>(span: Span, fn: () => T): T {
	return context.with(trace.setSpan(context.active(), span), fn);
}

/** Records a model call that had to be re-asked. Kept as an event rather than a
 *  counter so the trace shows *when* the run started struggling. */
export function recordRetryOnRunSpan(
	span: Span,
	info: { agentNode?: string; attempt: number; maxAttempts: number; rawError: string },
): void {
	span.addEvent("model.retry", {
		"fluxify.agent": info.agentNode ?? "unknown",
		"fluxify.retry.attempt": info.attempt,
		"fluxify.retry.max_attempts": info.maxAttempts,
		// The raw provider message, not the user-facing explanation — this is the
		// one place the underlying cause is worth keeping verbatim.
		"exception.message": info.rawError.slice(0, 1000),
	});
}

/**
 * Closes the run span with what the run actually cost and how it ended. `error`
 * is the raw thrown value: the friendly `aiResponse` explanation is for the
 * user, the trace wants the real thing.
 */
export function endRunSpan(
	span: Span,
	outcome: {
		usage: RunUsage;
		status: string;
		error?: unknown;
		failedNode?: string;
	},
): void {
	const { usage } = outcome;
	span.setAttributes({
		"fluxify.run.status": outcome.status,
		"fluxify.run.model_calls": usage.calls,
		"fluxify.run.retries": usage.retries,
		"fluxify.run.model_ms": usage.modelMs,
		"fluxify.run.elapsed_ms": usage.elapsedMs,
		"fluxify.run.usage_by_agent": JSON.stringify(usage.byAgent),
		"llm.token_count.prompt": usage.inputTokens,
		"llm.token_count.completion": usage.outputTokens,
		"llm.token_count.total": usage.totalTokens,
		"llm.token_count.prompt_details.cache_read": usage.cachedInputTokens,
	});
	if (outcome.failedNode) {
		span.setAttribute("fluxify.run.failed_node", outcome.failedNode);
	}

	if (outcome.error !== undefined) {
		span.recordException(
			outcome.error instanceof Error
				? outcome.error
				: new Error(String(outcome.error)),
		);
		span.setStatus({
			code: 2,
			message:
				outcome.error instanceof Error
					? outcome.error.message
					: String(outcome.error),
		});
	} else {
		span.setStatus({ code: 1 });
	}

	span.end();
}
