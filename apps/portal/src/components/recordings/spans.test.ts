import { expect, test } from "bun:test";
import type { RecordedSpan } from "@/services/recordings";
import {
	blockStatuses,
	calledBlockId,
	GHOST_NODE_TYPE,
	isIncomplete,
	overlayGraph,
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
		{ id: "e1", from: "entry", to: "if", fromHandle: "entry-source", toHandle: "if-target" },
		{ id: "e2", from: "if", to: "call", fromHandle: "if-success", toHandle: "call-target" },
		{ id: "e3", from: "if", to: "call", fromHandle: "if-failure", toHandle: "call-target" },
		{ id: "e4", from: "if", to: "fail", fromHandle: "if-failure", toHandle: "fail-target" },
	];
	expect(takenEdgeIds(edges, spansAt(spans, null))).toEqual(["e1", "e2"]);
});

test("control edges light up: failure branch, retry body, switch case", () => {
	// persisted handle ids are `<blockId>-<kind>`, block ids being uuids
	const id = (name: string) => `0190a0b0-0000-7000-8000-${name.padStart(12, "0")}`;
	const h = (block: string, kind: string) => `${id(block)}-${kind}`;
	const edge = (name: string, from: string, kind: string, to: string) => ({
		id: name,
		from: id(from),
		to: id(to),
		fromHandle: h(from, kind),
		toHandle: h(to, "target"),
	});
	const edges = [
		edge("ok", "1", "success", "2"),
		edge("ko", "1", "failure", "3"),
		edge("body", "4", "executor", "5"),
		edge("retryOk", "4", "success", "6"),
		edge("retryKo", "4", "failure", "7"),
		edge("case1", "8", "case", "2"),
		edge("case2", "8", "case", "3"),
	];
	const level = [
		span(0, id("1"), { blockType: "if", branch: "failure" }),
		span(1, id("3")),
		span(2, id("5")),
		span(3, id("4"), { blockType: "retry", branch: "success" }),
		span(4, id("6")),
		// the switch picked case 2, but block 2 also ran (from elsewhere)
		span(5, id("8"), { blockType: "switch", metadata: { next: id("3") } }),
		span(6, id("2")),
	];
	expect(takenEdgeIds(edges, level).sort()).toEqual(["body", "case2", "ko", "retryOk"]);
});

test("a block deleted since the run is drawn as a ghost where it ran", () => {
	const saved = {
		blocks: [{ id: "entry", type: "entrypoint", position: { x: 0, y: 0 }, data: {} }],
		edges: [],
	};
	const level = [
		span(0, "entry"),
		span(1, "gone", {
			blockName: "Old step",
			outcome: "failure",
			metadata: { position: { x: 40, y: 80 } },
		}),
		// recorded before positions were: cannot be drawn, only counted
		span(2, "older"),
		span(3, "older"),
		// a middleware has no canvas, so it is neither drawn nor "removed"
		span(4, "middleware:m", { middleware: { id: "m" } }),
	];
	const { graph, lost } = overlayGraph(saved, level);
	expect(lost).toBe(2);
	expect(graph.blocks).toEqual([
		{ id: "entry", type: "entrypoint", position: { x: 0, y: 0 }, data: { status: true } },
		{
			id: "gone",
			type: GHOST_NODE_TYPE,
			position: { x: 40, y: 80 },
			data: { blockType: "js", blockName: "Old step", status: false },
		},
	]);
});

test("incomplete runs", () => {
	const run = { truncated: false, droppedSpans: 0, durationMs: 5 };
	expect(isIncomplete(run)).toBe(false);
	expect(isIncomplete({ ...run, droppedSpans: 1 })).toBe(true);
	expect(isIncomplete({ ...run, durationMs: null })).toBe(true);
	expect(isIncomplete({ ...run, truncated: true })).toBe(true);
});
