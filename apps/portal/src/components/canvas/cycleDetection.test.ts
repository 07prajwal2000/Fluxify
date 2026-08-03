import { expect, test } from "bun:test";
import { findCycleEdgeIds } from "./cycleDetection";
import type { CanvasEdge } from "./types";

const edge = (id: string, from: string, to: string): CanvasEdge => ({
	id,
	from,
	to,
	fromHandle: "",
	toHandle: "",
});

test("returns every edge in a multi-block cycle, but not feeder edges", () => {
	const cycleEdgeIds = findCycleEdgeIds([
		edge("feed", "start", "if"),
		edge("false", "if", "db"),
		edge("run", "db", "js"),
		edge("loop", "js", "if"),
	]);

	expect(cycleEdgeIds).toEqual(new Set(["false", "run", "loop"]));
});

test("returns no edges for an acyclic graph", () => {
	expect(findCycleEdgeIds([edge("one", "a", "b"), edge("two", "b", "c")])).toEqual(
		new Set(),
	);
});
