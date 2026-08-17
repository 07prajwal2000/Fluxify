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

test("after adding a block and saving, the refetch matches the screen, not the last load", () => {
	// What the canvas loaded, what is on screen after adding a block, and what
	// the server hands back once that block is saved.
	const loaded = graphTopology([node("a")], []);
	const onScreen = graphTopology([node("a"), node("added")], []);
	const refetched = graphTopology([node("added"), node("a")], []);

	// Comparing against the previous load says "different graph" and wipes the
	// undo stack on every save — comparing against the screen does not.
	expect(refetched).not.toBe(loaded);
	expect(refetched).toBe(onScreen);
});
