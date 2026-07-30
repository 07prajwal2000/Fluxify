import { expect, test } from "bun:test";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import type { BlockEdge, BlockNode } from "../types";
import { buildElkGraph, portSide } from "./elkLayout";

test("port sides follow the rendered handle geometry", () => {
	expect(portSide("n1-target")).toBe("WEST");
	expect(portSide("n1-source")).toBe("EAST");
	expect(portSide("n1-success")).toBe("EAST");
	expect(portSide("n1-failure")).toBe("EAST");
	expect(portSide("n1-executor")).toBe("NORTH");
	// Unknown suffix falls back to the outbound side rather than throwing.
	expect(portSide("n1-whatever")).toBe("EAST");
});

function node(id: string, type: string): BlockNode {
	return { id, type, position: { x: 0, y: 0 }, data: {} };
}

const edge = (id: string, from: string, to: string, fromHandle: string): BlockEdge => ({
	id,
	source: from,
	target: to,
	sourceHandle: fromHandle,
	targetHandle: `${to}-target`,
});

test("the graph lays out horizontally with ports pinned per handle", () => {
	const graph = buildElkGraph(
		[
			node("a", BLOCK_TYPES.entrypoint),
			node("b", BLOCK_TYPES.if),
			node("c", BLOCK_TYPES.response),
		],
		[edge("e1", "a", "b", "a-source"), edge("e2", "b", "c", "b-success")],
	);

	expect(graph.layoutOptions?.["elk.direction"]).toBe("RIGHT");
	expect(graph.children).toHaveLength(3);
	expect(graph.edges).toHaveLength(2);

	const b = graph.children?.find((child) => child.id === "b");
	expect(b?.layoutOptions?.["elk.portConstraints"]).toBe("FIXED_SIDE");
	// Only the handles actually connected become ports.
	expect(
		b?.ports?.map((port) => [port.id, port.layoutOptions?.["elk.port.side"]]),
	).toEqual([
		["b-target", "WEST"],
		["b-success", "EAST"],
	]);
});

test("sticky notes and their edges are left out of the layout", () => {
	const graph = buildElkGraph(
		[node("a", BLOCK_TYPES.entrypoint), node("note", BLOCK_TYPES.stickynote)],
		[edge("e1", "a", "note", "a-source")],
	);

	expect(graph.children?.map((child) => child.id)).toEqual(["a"]);
	expect(graph.edges).toHaveLength(0);
});
