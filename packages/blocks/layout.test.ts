import { expect, test } from "bun:test";
import { BlockTypes } from "./blockTypes";
import { handleSide, layerOf, layoutGraph, type LayoutNode } from "./layout";

const node = (id: string, type: string, x = 0, y = 0): LayoutNode => ({
	id,
	type,
	position: { x, y },
	width: 160,
	height: 40,
});

const edge = (from: string, to: string, kind = "source") => ({
	id: `${from}-${to}`,
	from,
	to,
	fromHandle: `${from}-${kind}`,
	toHandle: `${to}-target`,
});

test("handle sides follow the rendered geometry", () => {
	expect(handleSide("n1-target")).toBe("left");
	expect(handleSide("n1-source")).toBe("right");
	expect(handleSide("n1-executor")).toBe("top");
	// Unknown suffix falls back to the outbound side rather than throwing.
	expect(handleSide("n1-whatever")).toBe("right");
});

test("each block sits one column past its furthest predecessor", () => {
	const layers = layerOf(
		[
			node("a", BlockTypes.entrypoint),
			node("b", BlockTypes.if),
			node("c", BlockTypes.jsrunner),
			node("d", BlockTypes.response),
		],
		[edge("a", "b"), edge("b", "c", "success"), edge("b", "d", "failure"), edge("c", "d")],
	);
	// `d` is reachable in two hops via `b` and three via `c` — the longer path wins,
	// otherwise it would be drawn to the left of a block that feeds it.
	expect([...layers.values()]).toEqual([0, 1, 2, 3]);
});

test("a cycle the editor could never produce does not hang the layout", () => {
	const positions = layoutGraph(
		[node("a", BlockTypes.jsrunner), node("b", BlockTypes.jsrunner)],
		[edge("a", "b"), edge("b", "a")],
	);
	expect(Object.keys(positions).sort()).toEqual(["a", "b"]);
});

test("blocks in one column never overlap", () => {
	const positions = layoutGraph(
		[
			node("a", BlockTypes.entrypoint),
			node("b", BlockTypes.jsrunner),
			node("c", BlockTypes.response),
		],
		[edge("a", "b"), edge("a", "c")],
	);
	expect(positions.b!.x).toBe(positions.c!.x);
	expect(Math.abs(positions.b!.y - positions.c!.y)).toBeGreaterThanOrEqual(40);
});

test("sticky notes stay where the user put them", () => {
	const positions = layoutGraph(
		[node("a", BlockTypes.entrypoint), node("note", BlockTypes.sticky_note, 900, 900)],
		[],
	);
	expect(positions.note).toBeUndefined();
});

test("an edit reflows around the blocks it did not touch", () => {
	const existing = [
		node("a", BlockTypes.entrypoint, 0, 0),
		node("b", BlockTypes.response, 224, 0),
	];
	// The agent drops a block on top of the response block.
	const inserted = node("new", BlockTypes.jsrunner, 224, 0);

	const moved = layoutGraph(
		[...existing, inserted],
		[edge("a", "new"), edge("new", "b")],
		{ changedIds: ["new"] },
	);

	// The entrypoint is untouched, so it anchors the frame and is not rewritten.
	expect(moved.a).toBeUndefined();
	// The new block already sat in the column the layout wants, so it is not
	// rewritten either — only the block it collided with is pushed along.
	expect(moved.new).toBeUndefined();
	expect(moved.b!.x).toBeGreaterThan(inserted.position!.x);
});
