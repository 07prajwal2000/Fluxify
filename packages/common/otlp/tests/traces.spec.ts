import { describe, it, expect } from "bun:test";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
	type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode } from "@opentelemetry/api";
import { createOtlpTracerProvider, exportRun, spanIdFor, traceIdFor } from "../traces";
import type { TraceRunPayload, TraceSpanRecord } from "../types";

/** perf origin is arbitrary; the point is that it is not the wall clock */
const PERF_ORIGIN = 1_000;
const WALL_START = Date.UTC(2026, 0, 1, 12, 0, 0);

function collector() {
	const exporter = new InMemorySpanExporter();
	const provider = createOtlpTracerProvider({
		url: "http://unused",
		serviceName: "test",
		processor: new SimpleSpanProcessor(exporter),
	});
	return { provider, spans: () => exporter.getFinishedSpans() };
}

const span = (
	seq: number,
	blockId: string,
	startedAt: number,
	endedAt: number,
	extra: Partial<TraceSpanRecord> = {},
): TraceSpanRecord => ({
	seq,
	blockId,
	blockType: "jsrunner",
	startedAt: PERF_ORIGIN + startedAt,
	endedAt: PERF_ORIGIN + endedAt,
	outcome: "success",
	...extra,
});

const run = (overrides: Partial<TraceRunPayload> = {}): TraceRunPayload => ({
	runId: "run-1",
	projectId: "proj-1",
	routeId: "route-1",
	routeVersion: "2026-01-01T12:00:00.000Z",
	method: "POST",
	path: "/orders",
	startedAtWallMs: WALL_START,
	perfOrigin: PERF_ORIGIN,
	endedAt: PERF_ORIGIN + 100,
	outcome: "success",
	spans: [],
	...overrides,
});

/** epoch millis from the SDK's [seconds, nanos] pair */
const millis = (time: [number, number]) => time[0] * 1000 + time[1] / 1e6;
const byName = (spans: ReadableSpan[], id: string) =>
	spans.find((s) => s.attributes["fluxify.block.id"] === id)!;

describe("exportRun", () => {
	it("rebuilds wall-clock time from the monotonic readings", () => {
		const { provider, spans } = collector();

		exportRun(provider, run({ spans: [span(0, "entry", 10, 40)] }));

		const block = byName(spans(), "entry");
		expect(millis(block.startTime)).toBe(WALL_START + 10);
		expect(millis(block.endTime)).toBe(WALL_START + 40);
		// the root covers the whole run, not just the blocks
		const root = spans().find((s) => s.name === "POST /orders")!;
		expect(millis(root.startTime)).toBe(WALL_START);
		expect(millis(root.endTime)).toBe(WALL_START + 100);
	});

	it("nests a custom block's spans under the block that invoked it", () => {
		const { provider, spans } = collector();

		// The invoking block completes last, so it is recorded last and carries the
		// highest seq despite being the parent — the ordering trap this guards.
		exportRun(
			provider,
			run({
				spans: [
					span(0, "entry", 0, 5),
					span(1, "inner", 12, 18, {
						parentSeq: 2,
						customBlockId: "cb-1",
					}),
					span(2, "invoke", 10, 20),
				],
			}),
		);

		const found = spans();
		expect(found).toHaveLength(4);
		expect(byName(found, "inner").parentSpanId).toBe(
			byName(found, "invoke").spanContext().spanId,
		);
		expect(byName(found, "invoke").parentSpanId).toBe(
			found.find((s) => s.name === "POST /orders")!.spanContext().spanId,
		);
		expect(byName(found, "inner").attributes["fluxify.custom_block.id"]).toBe(
			"cb-1",
		);
	});

	it("puts every span of a run in one trace, addressable from the run id", () => {
		const { provider, spans } = collector();

		exportRun(provider, run({ spans: [span(0, "entry", 0, 5)] }));

		const traceIds = new Set(spans().map((s) => s.spanContext().traceId));
		expect([...traceIds]).toEqual([traceIdFor("run-1")]);
		expect(byName(spans(), "entry").spanContext().spanId).toBe(
			spanIdFor("run-1", 0),
		);
	});

	it("gives a redelivered run the same ids, so it is not a second trace", () => {
		const { provider, spans } = collector();
		const payload = run({ spans: [span(0, "entry", 0, 5)] });

		exportRun(provider, payload);
		exportRun(provider, payload);

		const found = spans();
		expect(found).toHaveLength(4);
		expect(found[0]!.spanContext().spanId).toBe(found[2]!.spanContext().spanId);
		expect(found[1]!.spanContext().spanId).toBe(found[3]!.spanContext().spanId);
	});

	it("records the error on the block that failed", () => {
		const { provider, spans } = collector();

		exportRun(
			provider,
			run({
				outcome: "failure",
				spans: [
					span(0, "entry", 0, 5),
					span(1, "explode", 6, 9, { outcome: "failure", error: "boom" }),
				],
			}),
		);

		const failed = byName(spans(), "explode");
		expect(failed.status.code).toBe(SpanStatusCode.ERROR);
		expect(failed.events[0]?.name).toBe("exception");
		expect(failed.events[0]?.attributes?.["exception.message"]).toBe("boom");
		expect(byName(spans(), "entry").status.code).toBe(SpanStatusCode.OK);
	});

	it("links a detached async run back to the span that dispatched it", () => {
		const { provider, spans } = collector();

		exportRun(
			provider,
			run({
				runId: "run-2",
				parentRunId: "run-1",
				parentSeq: 3,
				spans: [span(0, "async-entry", 0, 5)],
			}),
		);

		const root = spans().find((s) => s.name === "POST /orders")!;
		// its own trace — a detached run outlives the request, so it cannot nest
		expect(root.spanContext().traceId).toBe(traceIdFor("run-2"));
		expect(root.links[0]?.context).toMatchObject({
			traceId: traceIdFor("run-1"),
			spanId: spanIdFor("run-1", 3),
		});
	});

	it("carries dropped and truncated state onto the run, so gaps are visible", () => {
		const { provider, spans } = collector();

		exportRun(
			provider,
			run({ truncated: true, droppedSpans: 7, statusCode: 500 }),
		);

		const root = spans().find((s) => s.name === "POST /orders")!;
		expect(root.attributes["fluxify.dropped_spans"]).toBe(7);
		expect(root.attributes["fluxify.truncated"]).toBe(true);
		expect(root.attributes["http.response.status_code"]).toBe(500);
	});
});
