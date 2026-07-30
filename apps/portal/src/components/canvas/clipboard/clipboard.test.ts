import { expect, test } from "bun:test";
import { handleId } from "../blocks/handles/handleConfig";
import type { BlockEdge, BlockNode } from "../types";
import { cloneGraphPart, pickGraphPart } from "./cloneGraphPart";

const node = (id: string, selected = false): BlockNode => ({
	id,
	type: "consolelog",
	position: { x: 10, y: 20 },
	data: { config: { message: "hi" } },
	selected,
});

const edge = (id: string, source: string, target: string): BlockEdge => ({
	id,
	source,
	target,
	sourceHandle: handleId(source, "source"),
	targetHandle: handleId(target, "target"),
});

test("a copy takes the selection plus the edges between the selected blocks", () => {
	const nodes = [node("a", true), node("b", true), node("c")];
	const edges = [edge("e1", "a", "b"), edge("e2", "b", "c")];

	const part = pickGraphPart(nodes, edges);
	expect(part.nodes.map((n) => n.id)).toEqual(["a", "b"]);
	// e2 leaves the selection, so it is not part of the copy.
	expect(part.edges.map((e) => e.id)).toEqual(["e1"]);

	// Explicit ids win over the selection (that is what duplicate passes).
	expect(pickGraphPart(nodes, edges, ["c"]).nodes.map((n) => n.id)).toEqual(["c"]);
	expect(pickGraphPart(nodes, edges, []).nodes).toEqual([]);
});

test("clones get fresh ids, remapped handles and an offset", () => {
	const part = { nodes: [node("a"), node("b")], edges: [edge("e1", "a", "b")] };

	const clone = cloneGraphPart(part, { offset: { x: 32, y: 32 }, select: true });
	const [a, b] = clone.nodes;
	const [connection] = clone.edges;

	expect([a.id, b.id]).not.toContain("a");
	expect(new Set([a.id, b.id, connection.id]).size).toBe(3);
	expect(a.position).toEqual({ x: 42, y: 52 });
	expect(a.selected).toBe(true);

	// The edge must follow the clones, through their own sockets.
	expect(connection.source).toBe(a.id);
	expect(connection.target).toBe(b.id);
	expect(connection.sourceHandle).toBe(handleId(a.id, "source"));
	expect(connection.targetHandle).toBe(handleId(b.id, "target"));
});

test("cloned data is detached from the original", () => {
	const original = node("a");
	const [clone] = cloneGraphPart({ nodes: [original], edges: [] }).nodes;

	(clone.data.config as { message: string }).message = "changed";
	expect((original.data.config as { message: string }).message).toBe("hi");
});

test("an edge with an endpoint outside the copy is dropped", () => {
	const clone = cloneGraphPart({
		nodes: [node("a")],
		edges: [edge("e1", "a", "outside")],
	});

	expect(clone.nodes).toHaveLength(1);
	expect(clone.edges).toEqual([]);
});
