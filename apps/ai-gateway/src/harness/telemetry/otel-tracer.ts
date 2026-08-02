import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { trace, context, type Span } from "@fluxify/common/tracing";

export class FluxifyOtelTracer extends BaseCallbackHandler {
	name = "fluxify_otel_tracer";
	private spans = new Map<string, Span>();

	private sanitizeData(data: any): any {
		if (!data) return data;
		if (typeof data === "object") {
			if (Array.isArray(data)) {
				return data.map((item) => this.sanitizeData(item));
			}
			const cloned = { ...data };
			// Remove sensitive and noisy state fields
			if (cloned.agentWrapper) {
				delete cloned.agentWrapper;
			}
			if (cloned.internal) {
				delete cloned.internal;
			}
			return cloned;
		}
		return data;
	}

	private safeStringify(obj: any): string {
		try {
			const sanitized = this.sanitizeData(obj);
			if (typeof sanitized === "string") return sanitized;
			return JSON.stringify(sanitized);
		} catch {
			return String(obj);
		}
	}

	private startSpan(
		id: string,
		name: string,
		parentRunId?: string,
		kind: string = "CHAIN",
	) {
		const tracer = trace.getTracer("fluxify-langchain-tracer");
		const parentSpan = parentRunId ? this.spans.get(parentRunId) : undefined;

		let ctx = context.active();
		if (parentSpan) {
			ctx = trace.setSpan(ctx, parentSpan);
		}

		const span = tracer.startSpan(
			name,
			{
				attributes: {
					"openinference.span.kind": kind,
				},
			},
			ctx,
		);
		this.spans.set(id, span);
	}

	private endSpan(id: string, error?: unknown, outputs?: any) {
		const span = this.spans.get(id);
		if (!span) return;

		if (error) {
			// Provider SDKs reject with plain objects as happily as with Errors
			// (`{ code: 23 }`), and `recordException` would keep none of it.
			const thrown =
				error instanceof Error ? error : new Error(this.safeStringify(error));
			span.recordException(thrown);
			span.setStatus({ code: 2, message: thrown.message }); // 2 = ERROR
		} else {
			span.setStatus({ code: 1 }); // 1 = OK
		}

		if (outputs !== undefined) {
			span.setAttribute("output.value", this.safeStringify(outputs));
		}

		span.end();
		this.spans.delete(id);
	}

	async handleChainStart(
		run: any,
		inputs: any,
		runId: string,
		parentRunId?: string,
		tags?: string[],
		metadata?: any,
		runType?: string,
		name?: string,
	) {
		// Attempt to extract the clearest name for the span
		let spanName = typeof name === "string" ? name : (run.name || run.id?.[run.id.length - 1] || "chain");
		
		if (spanName === "LangGraph") {
			spanName = "harness.fluxify";
		} else if (metadata?.langgraph_node) {
			spanName = `Node: ${metadata.langgraph_node}`;
		}

		this.startSpan(runId, spanName, parentRunId, "CHAIN");
		const span = this.spans.get(runId);
		if (span) {
			span.setAttribute("input.value", this.safeStringify(inputs));
			if (tags && tags.length > 0) {
				span.setAttribute("langchain.tags", JSON.stringify(tags));
			}
		}
	}

	async handleChainEnd(outputs: any, runId: string) {
		this.endSpan(runId, undefined, outputs);
	}

	async handleChainError(error: Error, runId: string) {
		this.endSpan(runId, error);
	}

	async handleLLMStart(
		llm: any,
		prompts: string[],
		runId: string,
		parentRunId?: string,
		extraParams?: any,
		tags?: string[],
		metadata?: any,
		name?: string,
	) {
		const llmName = typeof name === "string" ? name : (llm.name || llm.id?.[llm.id.length - 1] || "llm");
		this.startSpan(runId, `LLM: ${llmName}`, parentRunId, "LLM");
		const span = this.spans.get(runId);
		if (span) {
			span.setAttribute("input.value", this.safeStringify(prompts));
			// Which model actually served the call — the run may be configured with
			// one and fall back to another, and token counts mean nothing without it.
			const params = extraParams?.invocation_params;
			const model = params?.model ?? params?.model_name;
			if (model) span.setAttribute("llm.model_name", String(model));
			if (metadata) {
				span.setAttribute("llm.metadata", JSON.stringify(metadata));
			}
		}
	}

	/**
	 * Token usage for one model call, in OpenInference attribute names.
	 *
	 * `llmOutput.tokenUsage` is the OpenAI-shaped field and is simply absent for
	 * several providers; the portable place is `usage_metadata` on the returned
	 * message, which every LangChain chat model normalizes to. Read both, prefer
	 * the message, and carry the cache-read count — prompt caching is invisible
	 * without it, and it is the cheapest token there is.
	 */
	private usageAttributes(output: any): Record<string, number> {
		const messages = (output?.generations ?? [])
			.flat()
			.map((generation: any) => generation?.message)
			.filter(Boolean);

		const totals = { prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0 };
		let found = false;
		for (const message of messages) {
			const usage = message.usage_metadata;
			if (!usage) continue;
			found = true;
			totals.prompt += usage.input_tokens ?? 0;
			totals.completion += usage.output_tokens ?? 0;
			totals.cacheRead += usage.input_token_details?.cache_read ?? 0;
			totals.cacheWrite += usage.input_token_details?.cache_creation ?? 0;
		}

		if (!found) {
			const legacy =
				output?.llmOutput?.tokenUsage || output?.llmOutput?.estimatedTokenUsage;
			if (!legacy) return {};
			totals.prompt = legacy.promptTokens ?? 0;
			totals.completion = legacy.completionTokens ?? 0;
		}

		return {
			"llm.token_count.prompt": totals.prompt,
			"llm.token_count.completion": totals.completion,
			"llm.token_count.total": totals.prompt + totals.completion,
			"llm.token_count.prompt_details.cache_read": totals.cacheRead,
			"llm.token_count.prompt_details.cache_write": totals.cacheWrite,
		};
	}

	async handleLLMEnd(output: any, runId: string) {
		const span = this.spans.get(runId);
		if (span) {
			span.setAttributes(this.usageAttributes(output));
		}
		this.endSpan(runId, undefined, output);
	}

	async handleLLMError(error: Error, runId: string) {
		this.endSpan(runId, error);
	}

	async handleToolStart(
		tool: any,
		input: string,
		runId: string,
		parentRunId?: string,
		tags?: string[],
		metadata?: any,
		name?: string,
	) {
		const toolName = name || tool.name || tool.id?.[tool.id.length - 1] || "tool";
		this.startSpan(runId, `Tool: ${toolName}`, parentRunId, "TOOL");
		const span = this.spans.get(runId);
		if (span) {
			span.setAttribute("input.value", this.safeStringify(input));
		}
	}

	async handleToolEnd(output: string, runId: string) {
		this.endSpan(runId, undefined, output);
	}

	async handleToolError(error: Error, runId: string) {
		this.endSpan(runId, error);
	}
}
