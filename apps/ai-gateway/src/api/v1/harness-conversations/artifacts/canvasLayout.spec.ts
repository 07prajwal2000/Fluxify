import { describe, expect, it } from "bun:test";
import { formattedCanvasChanges } from "./canvasLayout";
import type { CanvasItems } from "./normalize";

describe("formattedCanvasChanges layout anchoring", () => {
	/** A three-block route the user has already arranged on screen. */
	const arranged: CanvasItems = {
		blocks: [
			{ id: "e1", type: "entrypoint", data: {}, position: { x: 900, y: 300 } },
			{ id: "j1", type: "jsrunner", data: { value: "return 1" }, position: { x: 1132, y: 300 } },
			{ id: "r1", type: "response", data: { httpCode: "200" }, position: { x: 1364, y: 300 } },
		],
		edges: [
			{ id: "x1", from: "e1", to: "j1", fromHandle: "e1-source", toHandle: "j1-target" },
			{ id: "x2", from: "j1", to: "r1", fromHandle: "j1-source", toHandle: "r1-target" },
		],
	};

	it("keeps untouched blocks where the user put them when the agent re-emits the canvas", async () => {
		// The contract asks for NEW blocks in `blocks`, but an agent editing one
		// field routinely restates the whole canvas — with coordinates it invented
		// for a canvas it cannot see. Every block then read as "changed", the
		// layout had nothing to anchor on, and the whole route jumped to 0,0.
		const out = await formattedCanvasChanges(
			{
				blocks: [
					{ id: "e1", blockType: "entrypoint", data: {}, position: { x: 0, y: 0 }, connections: [{ blockId: "j1", handle: "source" }] },
					{ id: "j1", blockType: "jsrunner", data: { value: "return 2" }, position: { x: 200, y: 0 }, connections: [{ blockId: "r1", handle: "source" }] },
					{ id: "r1", blockType: "response", data: { httpCode: "200" }, position: { x: 400, y: 0 }, connections: [] },
				],
			},
			arranged,
		);

		const at = (id: string) => out.changes.blocks.find((b) => b.id === id)?.position;
		expect(at("e1")).toEqual({ x: 900, y: 300 });
		expect(at("r1")).toEqual({ x: 1364, y: 300 });
		// The one block it actually edited keeps its new configuration.
		expect(out.changes.blocks.find((b) => b.id === "j1")?.data).toMatchObject({
			value: "return 2",
		});
	});

	it("still re-flows around a genuinely new block", async () => {
		const out = await formattedCanvasChanges(
			{
				blocks: [
					{ id: "new_1", blockType: "consolelog", data: { message: "hi" }, position: { x: 0, y: 0 }, connections: [{ blockId: "r1", handle: "source" }] },
				],
				canvasChanges: [
					{ type: "edge_swap", data: { fromEdge: "j1", fromHandle: "source", toEdge: "new_1" } },
				],
			},
			arranged,
		);

		const placed = out.changes.blocks.find((b) => b.type === "consolelog");
		// Laid out relative to the arrangement it was inserted into, not at 0,0.
		expect(placed?.position.x).toBeGreaterThan(900);
	});
});
