import { expect, test } from "bun:test";
import { graphTopology } from "./BlockCanvas";
import type { BlockEdge, BlockNode } from "./types";

const node = (id: string, x = 0): BlockNode => ({
	id,
	type: "consolelog",
	position: { x, y: 0 },
	data: {},
});

const edge = (id: string): BlockEdge => ({ id, source: "a", target: "b" });

test("a reloaded graph keeps its identity, so saving does not wipe the undo stack", () => {
	const before = graphTopology([node("a"), node("b")], [edge("e1")]);
	// What a refetch after saving looks like: same ids, moved blocks, new objects.
	const after = graphTopology([node("b", 400), node("a", 120)], [edge("e1")]);
	expect(after).toBe(before);

	// A genuinely different graph does not.
	expect(graphTopology([node("a")], [edge("e1")])).not.toBe(before);
	expect(graphTopology([node("a"), node("b")], [])).not.toBe(before);
});
