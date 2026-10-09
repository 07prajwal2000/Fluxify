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

const bare = (id: string, type: string, data?: Record<string, unknown>): LayoutNode => ({
	id,
	type,
	width: 160,
	height: 40,
	data,
});
const at = (positions: Record<string, { x: number; y: number }>, id: string) => positions[id]!.y;

test("if: the true branch sits above the false branch, whatever order they arrive in", () => {
	const nodes = [
		bare("e", BlockTypes.entrypoint),
		bare("i", BlockTypes.if),
		bare("f", BlockTypes.jsrunner),
		bare("t", BlockTypes.jsrunner),
	];
	const edges = [edge("e", "i"), edge("i", "f", "failure"), edge("i", "t", "success")];
	const p = layoutGraph(nodes, edges);
	expect(at(p, "t")).toBeLessThan(at(p, "f"));
});

test("a top-handle child sits above the parent's right-hand children", () => {
	const nodes = [
		bare("e", BlockTypes.entrypoint),
		bare("loop", BlockTypes.forloop),
		bare("after", BlockTypes.jsrunner),
		bare("body", BlockTypes.jsrunner),
	];
	const edges = [edge("e", "loop"), edge("loop", "after", "source"), edge("loop", "body", "executor")];
	const p = layoutGraph(nodes, edges);
	expect(at(p, "body")).toBeLessThan(at(p, "after"));
});

test("switch: cases follow data.order, the default case comes last", () => {
	const nodes = [
		bare("e", BlockTypes.entrypoint),
		bare("sw", BlockTypes.switch, { order: ["c2", "c1"], defaultCase: "d" }),
		bare("c1", BlockTypes.jsrunner),
		bare("d", BlockTypes.jsrunner),
		bare("c2", BlockTypes.jsrunner),
	];
	const edges = [
		edge("e", "sw"),
		edge("sw", "c1", "case"),
		edge("sw", "d", "case"),
		edge("sw", "c2", "case"),
	];
	const p = layoutGraph(nodes, edges);
	expect(at(p, "c2")).toBeLessThan(at(p, "c1"));
	expect(at(p, "c1")).toBeLessThan(at(p, "d"));
});

const withErrorHandler = () => ({
	nodes: [
		bare("e", BlockTypes.entrypoint),
		bare("i", BlockTypes.if),
		bare("t", BlockTypes.jsrunner),
		bare("f", BlockTypes.jsrunner),
		bare("r", BlockTypes.response),
		bare("h", BlockTypes.errorHandler),
		bare("h1", BlockTypes.jsrunner),
		bare("h2", BlockTypes.jsrunner),
	],
	edges: [
		edge("e", "i"),
		edge("i", "t", "success"),
		edge("i", "f", "failure"),
		edge("t", "r"),
		edge("h", "h1"),
		edge("h", "h2"),
	],
});

test("the error handler's chain stays below the main chain, however often it is formatted", () => {
	const { nodes, edges } = withErrorHandler();
	let current = nodes;
	let first: Record<string, { x: number; y: number }> | undefined;
	for (let run = 0; run < 3; run++) {
		const p = layoutGraph(current, edges);
		first ??= p;
		expect(p).toEqual(first);
		const mainBottom = Math.max(...["e", "i", "t", "f", "r"].map((id) => at(p, id) + 40));
		for (const id of ["h", "h1", "h2"]) expect(at(p, id)).toBeGreaterThanOrEqual(mainBottom);
		// feed the result back in, the way a second Format press does
		current = current.map((n) => ({ ...n, position: p[n.id] }));
	}
});

test("the error handler stays below even when it was last on screen above", () => {
	const { nodes, edges } = withErrorHandler();
	const swapped = nodes.map((n) => ({
		...n,
		position: { x: 0, y: n.id.startsWith("h") ? -500 : 500 },
	}));
	const p = layoutGraph(swapped, edges);
	expect(at(p, "h")).toBeGreaterThan(at(p, "r"));
});

test("blocks with no position (agent-added) get a stable, non-overlapping layout", () => {
	const { nodes, edges } = withErrorHandler();
	const p = layoutGraph(nodes, edges);
	expect(layoutGraph([...nodes].reverse(), edges)).toEqual(p);
	const column = ["t", "f"].map((id) => at(p, id)).sort((a, b) => a - b);
	expect(column[1]! - column[0]!).toBeGreaterThanOrEqual(40);
});

test("with changedIds only the blocks that moved come back", () => {
	const { nodes, edges } = withErrorHandler();
	const p = layoutGraph(nodes, edges);
	const formatted = nodes.map((n) => ({ ...n, position: p[n.id] }));
	// nothing moved: nothing to persist
	expect(layoutGraph(formatted, edges, { changedIds: ["t"] })).toEqual({});
	// one block dragged away: only it snaps back
	const dragged = formatted.map((n) => (n.id === "f" ? { ...n, position: { x: 9, y: 9 } } : n));
	expect(Object.keys(layoutGraph(dragged, edges, { changedIds: ["f"] }))).toEqual(["f"]);
});
