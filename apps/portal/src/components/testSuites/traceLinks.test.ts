import { describe, expect, it } from "bun:test";
import type { RecordedSpan } from "@/services/recordings";
import { caseTraceLink, failingBlock } from "./traceLinks";

const traces = [
	{ caseIndex: 0, traceRunId: "t0" },
	{ caseIndex: 2, traceRunId: "t2" },
];

describe("caseTraceLink", () => {
	it("links each case to its own trace", () => {
		expect(caseTraceLink(traces, 2, false)).toEqual({ traceRunId: "t2" });
	});

	it("says expired once the run is past the max age", () => {
		expect(caseTraceLink([], 0, true)).toBe("expired");
	});

	it("shows nothing for a case with no trace", () => {
		expect(caseTraceLink(traces, 1, false)).toBeNull();
		expect(caseTraceLink(undefined, 0, false)).toBeNull();
	});
});

describe("failingBlock", () => {
	const span = (seq: number, blockId: string, outcome: string, parentSeq: number | null = null) =>
		({ seq, blockId, outcome, parentSeq }) as RecordedSpan;

	it("picks the first failed block on the run's own canvas", () => {
		const spans = [
			span(0, "entry", "success"),
			span(1, "call", "failure"),
			span(2, "inner", "failure", 1),
			span(3, "later", "failure"),
		];
		expect(failingBlock(spans)).toBe("call");
	});

	it("is null when nothing failed", () => {
		expect(failingBlock([span(0, "entry", "success")])).toBeNull();
	});
});
