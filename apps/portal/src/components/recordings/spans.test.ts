import { expect, test } from "bun:test";
import type { RecordedSpan } from "@/services/recordings";
import {
	blockStatuses,
	calledBlockId,
	isIncomplete,
	rootCanvasId,
	spansAt,
	takenEdgeIds,
} from "./spans";

const span = (seq: number, blockId: string, extra: Partial<RecordedSpan> = {}): RecordedSpan => ({
	seq,
	parentSeq: null,
	blockId,
	blockType: "js",
	blockName: null,
	customBlockId: null,
	middleware: null,
	startedAt: "2026-01-01T00:00:00.000Z",
	endedAt: "2026-01-01T00:00:00.010Z",
	outcome: "success",
	branch: null,
	error: null,
	input: null,
	output: null,
	truncated: false,
	metadata: null,
	...extra,
});

// route: entry -> if -(success)-> call (custom block A, called twice) ; if -(failure)-> fail
// A's canvas: inner; inner of the second call failed
const spans = [
	span(0, "entry"),
	span(1, "if", { branch: "success" }),
	span(3, "inner", { parentSeq: 2, customBlockId: "A" }),
	span(2, "call"),
	span(5, "inner", { parentSeq: 4, customBlockId: "A", outcome: "failure" }),
	span(4, "call", { outcome: "failure" }),
];

test("a level holds only the spans directly under it", () => {
	expect(spansAt(spans, null).map((s) => s.seq)).toEqual([0, 1, 2, 4]);
	// two calls of the same block are two separate levels
	expect(spansAt(spans, 2).map((s) => s.seq)).toEqual([3]);
	expect(spansAt(spans, 4).map((s) => s.seq)).toEqual([5]);
});

test("a call opens the custom block its inner spans ran in", () => {
	expect(calledBlockId(spans, spans[3])).toBe("A");
	expect(calledBlockId(spans, spans[0])).toBeNull();
	// a middleware's steps have no canvas
	const mw = [span(0, "middleware:m"), span(1, "middleware:m:x", { parentSeq: 0 })];
	expect(calledBlockId(mw, mw[0])).toBeNull();
	expect(rootCanvasId(spans)).toBeNull();
	expect(rootCanvasId([span(0, "x", { customBlockId: "A" })])).toBe("A");
});

test("any failed run of a block marks it failed; unrun blocks are absent", () => {
	expect(blockStatuses(spansAt(spans, null))).toEqual({
		entry: true,
		if: true,
		call: false,
	});
});

test("taken edges follow the condition branch", () => {
	const edges = [
		{ id: "e1", from: "entry", to: "if", fromHandle: "", toHandle: "" },
		{ id: "e2", from: "if", to: "call", fromHandle: "success", toHandle: "" },
		{ id: "e3", from: "if", to: "call", fromHandle: "failure", toHandle: "" },
		{ id: "e4", from: "if", to: "fail", fromHandle: "failure", toHandle: "" },
	];
	expect(takenEdgeIds(edges, spansAt(spans, null))).toEqual(["e1", "e2"]);
});

test("incomplete runs", () => {
	const run = { truncated: false, droppedSpans: 0, durationMs: 5 };
	expect(isIncomplete(run)).toBe(false);
	expect(isIncomplete({ ...run, droppedSpans: 1 })).toBe(true);
	expect(isIncomplete({ ...run, durationMs: null })).toBe(true);
	expect(isIncomplete({ ...run, truncated: true })).toBe(true);
});
