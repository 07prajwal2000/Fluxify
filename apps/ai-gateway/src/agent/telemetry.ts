import { OpenTelemetry } from "@ai-sdk/otel";
import { setMetadata, setSession } from "@arizeai/openinference-core";
import { OpenInferenceBatchSpanProcessor } from "@arizeai/openinference-vercel";
import { logger } from "@fluxify/common";
import { initializeTracing } from "@fluxify/common/tracing";
import {
	type Attributes,
	type Context,
	context,
	SpanStatusCode,
	type Tracer,
	trace,
} from "@opentelemetry/api";
import type { TelemetryOptions, Tool } from "ai";

export { flushTraces } from "@fluxify/common/tracing";

/**
 * OpenInference traces of the agent (#719), off by default. The AI SDK emits the
 * spans (run root, one per model step, one per tool call); this file turns them
 * on, adds what the SDK does not know (stop reason, approval outcome, compaction)
 * and exports to LLM_OTLP_TRACES_ENDPOINT (Phoenix, Langfuse, ...).
 */

type Env = Record<string, string | undefined>;

export type TraceConfig = {
	endpoint: string;
	headers: Record<string, string>;
	sampleRate: number;
	/** false: prompts, messages and tool inputs/outputs stay out; metadata and tokens stay. */
	recordContent: boolean;
};

/** "key:value;key2:value2" (the format of LLM_OTLP_TRACES_HEADERS). */
export function parseHeaders(raw: string | undefined): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const part of raw?.split(";") ?? []) {
		const at = part.indexOf(":");
		const key = part.slice(0, at).trim();
		const value = part.slice(at + 1).trim();
		if (at > 0 && key && value) headers[key] = value;
	}
	return headers;
}

/** The tracing settings from env, or null when tracing is off. */
export function traceConfig(env: Env): TraceConfig | null {
	if (env.LLM_TRACING_ENABLED?.toLowerCase() !== "true") return null;
	const endpoint = env.LLM_OTLP_TRACES_ENDPOINT?.trim();
	if (!endpoint) {
		logger.warn("LLM_TRACING_ENABLED is set but LLM_OTLP_TRACES_ENDPOINT is empty", "Tracing");
		return null;
	}
	const rate = Number(env.LLM_TRACING_SAMPLE_RATE?.trim() || 1);
	return {
		endpoint,
		headers: parseHeaders(env.LLM_OTLP_TRACES_HEADERS),
		sampleRate: Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1,
		recordContent: env.LLM_TRACING_RECORD_CONTENT?.toLowerCase() === "true",
	};
}

type On = { tracer: Tracer; otel: OpenTelemetry; recordContent: boolean };
let on: On | null = null;

/** Starts exporting spans from `tracer` (tests pass an in-memory one). */
export function enableTelemetry(tracer: Tracer, recordContent: boolean) {
	on = { tracer, otel: new OpenTelemetry({ tracer, usage: true }), recordContent };
}
export function disableTelemetry() {
	on = null;
}

/**
 * Reads the env and, when tracing is on, builds the tracer provider (OTLP,
 * sampled) and turns telemetry on. Safe to call again. Needs no loader hook, so
 * it works under Bun, in the runner's worker thread and in the CLI.
 */
export function setupTelemetry(env: Env = process.env, init = initializeTracing) {
	if (on) return;
	const config = traceConfig(env);
	if (!config) return;
	const provider = init({
		serviceName: "fluxify.ai-gateway.llm",
		endpoint: config.endpoint,
		headers: config.headers,
		sampleRate: config.sampleRate,
		processor: (exporter) => new OpenInferenceBatchSpanProcessor({ exporter }),
		// the CLI handles Ctrl+C itself and flushes after each run
		exitHooks: false,
	});
	if (provider) enableTelemetry(provider.getTracer("fluxify.agent"), config.recordContent);
	logger.info(`LLM tracing on, exporting to ${config.endpoint}`, "Tracing");
}

/** The `telemetry` option for an AI SDK call. */
export function telemetryFor(functionId: string): TelemetryOptions {
	if (!on) return { isEnabled: false };
	return {
		isEnabled: true,
		functionId,
		recordInputs: on.recordContent,
		recordOutputs: on.recordContent,
		integrations: [on.otel],
	};
}

const KIND = "openinference.span.kind";
const CAP = 2000;
const clip = (s: string) => (s.length > CAP ? `${s.slice(0, CAP)}…` : s);
const text = (v: unknown) => (typeof v === "string" ? v : (JSON.stringify(v) ?? ""));

export type RunMeta = {
	projectId: string;
	mode: string;
	model: string;
	conversationId?: string;
	runId?: string;
};

/** `base` with the session and run metadata, which the processor copies onto every span started in it (the SDK's too). */
function metaContext(meta: RunMeta, base: Context = context.active()): Context {
	const { conversationId, runId, projectId, mode } = meta;
	const metadata = Object.fromEntries(
		Object.entries({ conversationId, runId, projectId, mode }).filter(([, v]) => v),
	);
	const ctx = setMetadata(base, metadata);
	return conversationId ? setSession(ctx, { sessionId: conversationId }) : ctx;
}

/** Runs `fn` in a span that ends with it; a throw marks the span failed. */
async function inSpan<T>(
	name: string,
	attributes: Attributes,
	fn: () => Promise<T>,
	done?: (result: T) => Attributes,
): Promise<T> {
	if (!on) return fn();
	const span = on.tracer.startSpan(name, { attributes });
	try {
		const result = await context.with(trace.setSpan(context.active(), span), fn);
		if (done) span.setAttributes(done(result));
		return result;
	} catch (e) {
		span.recordException(e as Error);
		span.setStatus({
			code: SpanStatusCode.ERROR,
			message: e instanceof Error ? e.message : String(e),
		});
		throw e;
	} finally {
		span.end();
	}
}

/** A compaction: a summary call (before/after tokens once it ends) or a trim batch. */
export const compactionSpan = <T>(
	kind: "summary" | "trim",
	fn: () => Promise<T>,
	done: (result: T) => Attributes,
) => inSpan("fluxify.compaction", { [KIND]: "CHAIN", "fluxify.compaction.kind": kind }, fn, done);

/** A trim batch is not async work: one span with its numbers. */
export function trimSpan(stats: { before: number; after: number; results: number }) {
	if (!on) return;
	on.tracer
		.startSpan("fluxify.compaction", {
			attributes: {
				[KIND]: "CHAIN",
				"fluxify.compaction.kind": "trim",
				"fluxify.compaction.tokens_before": stats.before,
				"fluxify.compaction.tokens_after": stats.after,
				"fluxify.compaction.results": stats.results,
			},
		})
		.end();
}

export type ToolCallInfo = { toolCallId: string; toolName: string; input: unknown };

/**
 * A tool call that did not go through the SDK's own tool span: the user turned it
 * down, or it ran after a deferred approval. Runs `fn` (when given) inside the span.
 */
export function toolSpan<T>(
	call: ToolCallInfo,
	approval: string,
	meta: RunMeta,
	fn: () => Promise<T> = async () => undefined as T,
) {
	return context.with(metaContext(meta), () =>
		inSpan(
			`execute_tool ${call.toolName}`,
			{
				[KIND]: "TOOL",
				"tool.name": call.toolName,
				"tool_call.id": call.toolCallId,
				"fluxify.approval": approval,
				...(on?.recordContent ? { "input.value": clip(text(call.input)) } : {}),
			},
			fn,
			(out) => (on?.recordContent && out !== undefined ? { "output.value": clip(text(out)) } : {}),
		),
	);
}

export type RunTrace = {
	/** Pass to streamText / generateText. */
	telemetry: TelemetryOptions;
	/** `fn` that runs inside the run, so its spans nest under it. */
	within: <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => R;
	/** The tool set with the approval outcome written on each call's span. */
	tools: <T extends Record<string, Tool>>(tools: T) => T;
	/** What the user decided about a call. A turned-down one gets its own span, since it never runs. */
	approval: (call: ToolCallInfo, outcome: string) => void;
	/** The run is over. `stop` is the reason it ended early, if it did. */
	end: (o: { stop?: string; finish?: string; error?: string; aborted?: boolean }) => void;
};

const off: RunTrace = {
	telemetry: { isEnabled: false },
	within: (fn) => fn,
	tools: (tools) => tools,
	approval: () => {},
	end: () => {},
};

/** The run root span (AGENT) around one agent loop. */
export function traceRun(meta: RunMeta, message?: unknown): RunTrace {
	if (!on) return off;
	const { recordContent } = on;
	const outcomes = new Map<string, string>();
	const base = metaContext(meta);
	const span = on.tracer.startSpan(
		"fluxify.agent.run",
		{
			attributes: {
				[KIND]: "AGENT",
				"llm.model_name": meta.model,
				"fluxify.mode": meta.mode,
				...(recordContent && message ? { "input.value": clip(text(message)) } : {}),
			},
		},
		base,
	);
	const ctx = trace.setSpan(base, span);
	return {
		telemetry: telemetryFor("fluxify.agent"),
		within:
			(fn) =>
			(...args) =>
				context.with(ctx, () => fn(...args)),
		tools: (tools) =>
			Object.fromEntries(
				Object.entries(tools).map(([name, t]) => [
					name,
					t.execute
						? {
								...t,
								execute: (input: never, opts: { toolCallId: string }) => {
									trace
										.getActiveSpan()
										?.setAttribute("fluxify.approval", outcomes.get(opts.toolCallId) ?? "auto");
									return (t.execute as (...a: unknown[]) => unknown)(input, opts);
								},
							}
						: t,
				]),
			) as typeof tools,
		approval: (call, outcome) => {
			outcomes.set(call.toolCallId, outcome);
			if (outcome === "denied") void context.with(ctx, () => toolSpan(call, outcome, meta));
		},
		end: ({ stop, finish, error, aborted }) => {
			if (!span.isRecording()) return;
			span.setAttributes({
				"fluxify.status": error ? "error" : aborted ? "aborted" : stop ? "stopped" : "completed",
				...(stop ? { "fluxify.stop_reason": stop } : {}),
				...(finish ? { "fluxify.finish_reason": finish } : {}),
			});
			if (error) span.setStatus({ code: SpanStatusCode.ERROR, message: clip(error) });
			span.end();
		},
	};
}
