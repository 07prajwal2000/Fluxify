import { describe, expect, it } from "bun:test";
import { previewGraph } from "./previewGraph";

const existing = {
	blocks: [
		{ id: "keep", type: "response", data: {}, position: { x: 0, y: 0 } },
		{ id: "gone", type: "response", data: {}, position: { x: 10, y: 0 } },
	],
	edges: [{ id: "e1", from: "keep", to: "gone", fromHandle: "keep-source", toHandle: "gone-target" }],
};

describe("previewGraph", () => {
	it("merges new blocks over the stored graph and drops removals", () => {
		const graph = previewGraph(
			{
				targetType: "route",
				targetId: "r1",
				blocks: [
					{ id: "block_1", blockType: "response", connections: [{ blockId: "keep" }] },
				],
				canvasChanges: [{ type: "block_remove", data: { blocks: ["gone"] } }],
			},
			existing,
		);

		const ids = graph.blocks.map((b) => b.id);
		expect(ids).toContain("keep");
		expect(ids).not.toContain("gone");
		expect(graph.blocks).toHaveLength(2); // keep + the agent's new block
		// the edge into the removed block goes with it
		expect(graph.edges.map((e) => e.id)).not.toContain("e1");
		expect(graph.edges).toHaveLength(1);
	});

	it("is a no-op preview when the agent proposed nothing", () => {
		expect(previewGraph({}, existing).blocks).toHaveLength(2);
	});

	it("shows the live canvas after the proposal has been applied", () => {
		const graph = previewGraph(
			{
				targetType: "route",
				targetId: "r1",
				blocks: [{ id: "block_1", blockType: "response" }],
			},
			existing,
			true,
		);

		expect(graph.blocks).toHaveLength(2);
	});
});
