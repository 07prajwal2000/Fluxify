import { describe, expect, it } from "bun:test";
import { canvasChangesFromPayload, type CanvasItems } from "./normalize";

// An error handler reached by an edge has no codegen, so one invented
// connection stops the whole route compiling — "No codegen for block type:
// error_handler". The editor cannot draw one; only an agent restating a
// canvas it was shown can.
describe("edges into a block that has no inbound socket", () => {
	const stored: CanvasItems = {
		blocks: [
			{ id: "entry", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
			{ id: "handler", type: "error_handler", data: {}, position: { x: -240, y: 0 } },
			{ id: "log", type: "consolelog", data: {}, position: { x: 232, y: 0 } },
		],
		edges: [
			{ id: "e-1", from: "entry", to: "log", fromHandle: "entry-source", toHandle: "log-target" },
		],
	};

	it("drops a declared connection into the error handler", () => {
		const result = canvasChangesFromPayload(
			{
				targetType: "route",
				targetId: "r-1",
				blocks: [
					{
						id: "log",
						blockType: "consolelog",
						position: { x: 232, y: 0 },
						connections: [{ blockId: "handler", handle: "source" }],
					},
				],
			},
			stored,
		);
		expect(result.changes.edges).toEqual([]);
	});

	it("keeps the entrypoint's real edge when its invented one is refused", () => {
		const result = canvasChangesFromPayload(
			{
				targetType: "route",
				targetId: "r-1",
				blocks: [
					{
						id: "entry",
						blockType: "entrypoint",
						position: { x: 0, y: 0 },
						connections: [{ blockId: "handler", handle: "source" }],
					},
				],
			},
			stored,
		);
		// The refused edge must not take `e-1` down with it as a replaced handle.
		expect(result.actionsToPerform.edges).toEqual([]);
	});

	it("drops an edge_swap that re-points at the error handler", () => {
		const result = canvasChangesFromPayload(
			{
				targetType: "route",
				targetId: "r-1",
				blocks: [],
				canvasChanges: [
					{
						type: "edge_swap",
						data: { fromEdge: "entry", fromHandle: "source", toEdge: "handler" },
					},
				],
			},
			stored,
		);
		expect(result.changes.edges).toEqual([]);
		expect(result.actionsToPerform.edges).toEqual([]);
	});

	it("still wires the error handler's own recovery flow", () => {
		const result = canvasChangesFromPayload(
			{
				targetType: "route",
				targetId: "r-1",
				blocks: [
					{
						id: "handler",
						blockType: "error_handler",
						position: { x: -240, y: 0 },
						connections: [{ blockId: "log", handle: "source" }],
					},
				],
			},
			stored,
		);
		expect(result.changes.edges).toHaveLength(1);
		expect(result.changes.edges[0]).toMatchObject({ from: "handler", to: "log" });
	});
});
