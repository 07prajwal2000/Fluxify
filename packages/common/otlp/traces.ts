import { createHash } from "node:crypto";
import {
	ROOT_CONTEXT,
	SpanKind,
	SpanStatusCode,
	TraceFlags,
	trace,
	type Context,
	type Span,
} from "@opentelemetry/api";
import {
	BasicTracerProvider,
	BatchSpanProcessor,
	type IdGenerator,
	type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
// http/JSON, not the proto exporter: under Bun the proto transport's keep-alive
// handling reports every flush as "Request timed out" (the quirk
// `tracing/instrumentation.ts` swallows). The JSON transport is the one the
// metrics exporter uses, and it round-trips against a live collector.
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import type { TraceRunPayload, TraceSpanRecord } from "./types";

/* ------------------------------------------------------------ identifiers */

const hash = (value: string, length: number) =>
	createHash("sha256").update(value).digest("hex").slice(0, length);

/** A run is addressable from its id alone — the portal viewer wants this. */
export const traceIdFor = (runId: string) => hash(runId, 32);
export const spanIdFor = (runId: string, seq: number | "run") =>
	hash(`${runId}:${seq}`, 16);

/**
 * Ids are derived from `runId`/`seq` rather than random so that re-exporting a
 * redelivered run lands on the same trace instead of creating a second one, and
 * so a detached async run can point a link at its parent without knowing
 * anything about how that parent was exported.
 *
 * The SDK's `IdGenerator` takes no arguments (`Tracer.js` calls it per span), so
 * the ids for the next span are staged here immediately before `startSpan`. Safe
 * because an export walks one run synchronously; nothing awaits mid-walk.
 */
const staged = { traceId: "", spanId: "" };

const idGenerator: IdGenerator = {
	generateTraceId: () => staged.traceId,
	generateSpanId: () => staged.spanId,
};

/* -------------------------------------------------------------- provider */

export interface OtlpTracerOptions {
	/** destination root, e.g. `http://localhost:4318` — `/v1/traces` is appended */
	url: string;
	headers?: Record<string, string>;
	serviceName: string;
	/** exposed for tests, which swap in an in-memory processor */
	processor?: SpanProcessor;
}

/**
 * An unregistered provider the caller owns. Deliberately not
 * `NodeTracerProvider`: that pulls `@opentelemetry/instrumentation`, which
 * eagerly loads `node:v8` and breaks every `@fluxify/common` importer under Bun.
 *
 * Nothing here registers globally or installs a process hook — one process holds
 * many of these, one per destination, and shuts them down independently.
 */
export function createOtlpTracerProvider({
	url,
	headers,
	serviceName,
	processor,
}: OtlpTracerOptions): BasicTracerProvider {
	return new BasicTracerProvider({
		idGenerator,
		// a second net under the recorder's own per-span cap
		spanLimits: { attributeValueLengthLimit: 8192 },
		resource: Resource.default().merge(
			new Resource({ "service.name": serviceName }),
		),
		spanProcessors: [
			processor ??
				new BatchSpanProcessor(
					new OTLPTraceExporter({
						url: `${url.replace(/\/$/, "")}/v1/traces`,
						headers: headers ?? {},
						keepAlive: false,
					}),
				),
		],
	});
}

/* ---------------------------------------------------------------- export */

function safeStringify(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

/** monotonic reading -> epoch millis, which `TimeInput` accepts as a number */
const wallClock = (run: TraceRunPayload, reading: number) =>
	run.startedAtWallMs + (reading - run.perfOrigin);

function spanAttributes(span: TraceSpanRecord) {
	const attributes: Record<string, string | number | boolean> = {
		"fluxify.block.id": span.blockId,
		"fluxify.block.type": span.blockType,
		"fluxify.seq": span.seq,
	};
	if (span.customBlockId)
		attributes["fluxify.custom_block.id"] = span.customBlockId;
	if (span.branch) attributes["fluxify.branch"] = span.branch;
	if (span.truncated) attributes["fluxify.truncated"] = true;
	if (span.input !== undefined)
		attributes["fluxify.input"] = safeStringify(span.input);
	if (span.output !== undefined)
		attributes["fluxify.output"] = safeStringify(span.output);
	return attributes;
}

function finish(span: Span, outcome: string, error: string | undefined, at: number) {
	if (outcome === "failure") {
		// `error` crossed the wire as a string; rebuild so the exception event
		// carries a type and message rather than being dropped entirely.
		if (error) span.recordException(new Error(error));
		span.setStatus({ code: SpanStatusCode.ERROR, message: error });
	} else {
		span.setStatus({ code: SpanStatusCode.OK });
	}
	span.end(at);
}

/**
 * Translate one recorded run into OTEL spans on `provider`.
 *
 * Returns after the spans are handed to the processor, not after they reach the
 * network — the caller acks on that, and waiting for a slow destination would
 * stall the consumer behind it.
 */
export function exportRun(
	provider: BasicTracerProvider,
	run: TraceRunPayload,
): void {
	const tracer = provider.getTracer("fluxify-route");

	staged.traceId = traceIdFor(run.runId);
	staged.spanId = spanIdFor(run.runId, "run");

	// A detached run outlives the request that started it, so it cannot nest.
	// It is its own root, linked back to the span that dispatched it.
	const links = run.parentRunId
		? [
				{
					context: {
						traceId: traceIdFor(run.parentRunId),
						spanId: spanIdFor(run.parentRunId, run.parentSeq ?? "run"),
						traceFlags: TraceFlags.SAMPLED,
					},
				},
			]
		: undefined;

	const rootAttributes: Record<string, string | number | boolean> = {
		"fluxify.run.id": run.runId,
		"fluxify.project.id": run.projectId,
		"fluxify.route.id": run.routeId,
		"fluxify.route.version": run.routeVersion,
		"http.request.method": run.method,
		"http.route": run.path,
	};
	if (run.statusCode) rootAttributes["http.response.status_code"] = run.statusCode;
	if (run.truncated) rootAttributes["fluxify.truncated"] = true;
	if (run.droppedSpans) rootAttributes["fluxify.dropped_spans"] = run.droppedSpans;
	if (run.parentRunId) rootAttributes["fluxify.parent_run.id"] = run.parentRunId;

	const root = tracer.startSpan(
		`${run.method} ${run.path}`,
		{
			kind: SpanKind.SERVER,
			startTime: wallClock(run, run.perfOrigin),
			attributes: rootAttributes,
			links,
			root: true,
		},
		ROOT_CONTEXT,
	);

	const rootContext = trace.setSpan(ROOT_CONTEXT, root);
	const contexts = new Map<number, Context>();

	// Ordered by start, not by `seq`: spans are recorded on completion, so a
	// custom block's children are recorded before the block that invoked them.
	// A parent always *starts* first, which makes this the ordering that
	// guarantees a parent context exists when its children are built.
	const ordered = [...run.spans].sort(
		(a, b) => a.startedAt - b.startedAt || a.seq - b.seq,
	);

	for (const record of ordered) {
		const parent =
			(record.parentSeq !== undefined
				? contexts.get(record.parentSeq)
				: undefined) ?? rootContext;

		staged.traceId = traceIdFor(run.runId);
		staged.spanId = spanIdFor(run.runId, record.seq);

		const span = tracer.startSpan(
			record.blockType,
			{
				startTime: wallClock(run, record.startedAt),
				attributes: spanAttributes(record),
			},
			parent,
		);
		contexts.set(record.seq, trace.setSpan(parent, span));
		finish(span, record.outcome, record.error, wallClock(run, record.endedAt));
	}

	finish(root, run.outcome, undefined, wallClock(run, run.endedAt));
}
