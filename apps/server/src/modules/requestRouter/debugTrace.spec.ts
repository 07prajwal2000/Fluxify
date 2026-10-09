import { describe, expect, it } from "bun:test";
import type { TraceSpanRecord } from "@fluxify/common/otlp";
import { decodeDebugTrace, encodeDebugTrace, MAX_DEBUG_TRACE_HEADER } from "./debugTrace";

const span = (seq: number, extra: Partial<TraceSpanRecord> = {}): TraceSpanRecord => ({
	seq,
	blockId: `0190a1b2-0000-7000-8000-${String(seq).padStart(12, "0")}`,
	blockType: "jsrunner",
	startedAt: 10 * seq,
	endedAt: 10 * seq + 4.4,
	outcome: "success",
	...extra,
});

const roundTrip = (spans: TraceSpanRecord[]) => decodeDebugTrace(encodeDebugTrace(spans))!;

describe("debug trace", () => {
	it("keeps each block's type, outcome, duration and output in run order", () => {
		const trace = roundTrip([
			span(1, { output: { id: 7 }, blockName: "make id" }),
			span(0, { blockType: "entrypoint" }),
		]);
		expect(trace.more).toBeUndefined();
		expect(trace.spans.map((s) => s.blockType)).toEqual(["entrypoint", "jsrunner"]);
		expect(trace.spans[1]).toMatchObject({
			blockName: "make id",
			outcome: "success",
			ms: 4,
			output: '{"id":7}',
		});
	});

	it("carries a failed block's error", () => {
		const [failed] = roundTrip([span(0, { outcome: "failure", error: "boom" })]).spans;
		expect(failed).toMatchObject({ outcome: "failure", error: "boom" });
	});

	it("cuts a long output", () => {
		const [one] = roundTrip([span(0, { output: "x".repeat(5_000) })]).spans;
		expect(one.output!.length).toBeLessThan(300);
		expect(one.output!.endsWith("…")).toBe(true);
	});

	it("leaves out blocks inside a custom block", () => {
		const trace = roundTrip([span(0), span(1, { parentSeq: 0 })]);
		expect(trace.spans).toHaveLength(1);
	});

	it("stays under the header cap and counts the blocks that did not fit", () => {
		const many = Array.from({ length: 60 }, (_, i) => span(i, { output: "y".repeat(200) }));
		const encoded = encodeDebugTrace(many);
		expect(encoded.length).toBeLessThanOrEqual(MAX_DEBUG_TRACE_HEADER);
		const trace = decodeDebugTrace(encoded)!;
		expect(trace.spans.length + trace.more!).toBe(60);
		expect(trace.more).toBeGreaterThan(0);
	});

	it("reads nothing from a missing or broken header", () => {
		expect(decodeDebugTrace(null)).toBeUndefined();
		expect(decodeDebugTrace("not-json")).toBeUndefined();
	});
});
