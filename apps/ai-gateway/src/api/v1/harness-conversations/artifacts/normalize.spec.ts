import { describe, expect, it } from "bun:test";
import {
	canvasChangesFromPayload,
	routeOpFromPayload,
	type CanvasItems,
} from "./normalize";

const EMPTY: CanvasItems = { blocks: [], edges: [] };

describe("routeOpFromPayload", () => {
	it("turns a create output into the ops create request", () => {
		const op = routeOpFromPayload(
			{
				action: "create",
				routeId: "agent-generated",
				data: {
					name: " Create Order ",
					method: "post",
					path: "orders//new",
					bodySchema: { dataType: "object" },
					querySchema: null,
				},
			},
			"proj-1",
		);

		expect(op as Record<string, unknown>).toEqual({
			action: "create",
			data: {
				name: "Create Order",
				path: "/orders/new",
				method: "POST",
				projectId: "proj-1",
				bodySchema: { dataType: "object" },
			},
		});
	});

	it("renames update-partial to the subject's action and drops schemas", () => {
		const op = routeOpFromPayload(
			{
				action: "update-partial",
				routeId: "r-1",
				data: { name: "Renamed", bodySchema: { dataType: "object" } },
			},
			"proj-1",
		);

		expect(op as Record<string, unknown>).toEqual({
			action: "modify",
			id: "r-1",
			data: { name: "Renamed" },
		});
	});
});

describe("canvasChangesFromPayload", () => {
	const newCanvas = {
		targetType: "route" as const,
		targetId: "r-1",
		blocks: [
			{
				id: "block_1",
				blockType: "errorHandler",
				blockName: "Errors",
				position: { x: 0, y: 0 },
				connections: [{ blockId: "block_2", handle: "source" }],
			},
			{
				id: "block_2",
				blockType: "response",
				data: { status: 200 },
				position: { x: 0, y: 100 },
				connections: [],
			},
		],
	};

	it("mints real ids, canonicalizes types and expands handles", () => {
		const result = canvasChangesFromPayload(newCanvas, EMPTY);

		const [first, second] = result.changes.blocks;
		expect(first.id).not.toBe("block_1");
		expect(second.id).not.toBe("block_2");
		// `errorHandler` is what the model says; `error_handler` is what storage
		// counts when it enforces exactly one per canvas
		expect(first.type).toBe("error_handler");
		expect(first.data).toEqual({ blockName: "Errors" });

		const [edge] = result.changes.edges;
		expect(edge.from).toBe(first.id);
		expect(edge.to).toBe(second.id);
		expect(edge.fromHandle).toBe(`${first.id}-source`);
		expect(edge.toHandle).toBe(`${second.id}-target`);

		expect(result.actionsToPerform.blocks).toEqual([
			{ id: first.id, action: "upsert" },
			{ id: second.id, action: "upsert" },
		]);
		expect(result.actionsToPerform.edges).toEqual([
			{ id: edge.id, action: "upsert" },
		]);
	});

	it("keeps stored ids and reuses the stored edge id", () => {
		const existing: CanvasItems = {
			blocks: [
				{ id: "stored-a", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
				{ id: "stored-b", type: "response", data: {}, position: { x: 0, y: 100 } },
			],
			edges: [
				{
					id: "edge-1",
					from: "stored-a",
					to: "stored-b",
					fromHandle: "stored-a-source",
					toHandle: "stored-b-target",
				},
			],
		};

		const result = canvasChangesFromPayload(
			{
				targetType: "route",
				targetId: "r-1",
				canvasChanges: [
					{
						type: "block_change",
						data: {
							blocksInfo: [
								{
									id: "stored-a",
									blockType: "entrypoint",
									position: { x: 5, y: 5 },
									connections: [{ blockId: "stored-b", handle: "source" }],
								},
							],
						},
					},
				],
			},
			existing,
		);

		expect(result.changes.blocks.map((b) => b.id)).toEqual(["stored-a"]);
		// same endpoints as the stored edge, so it updates rather than duplicates
		expect(result.changes.edges).toEqual([
			{
				id: "edge-1",
				from: "stored-a",
				to: "stored-b",
				fromHandle: "stored-a-source",
				toHandle: "stored-b-target",
			},
		]);
	});

	it("removes blocks and drops edges that would dangle", () => {
		const existing: CanvasItems = {
			blocks: [
				{ id: "stored-a", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
				{ id: "stored-b", type: "response", data: {}, position: { x: 0, y: 100 } },
			],
			edges: [],
		};

		const result = canvasChangesFromPayload(
			{
				targetType: "route",
				targetId: "r-1",
				blocks: [
					{
						id: "block_1",
						blockType: "consolelog",
						position: { x: 0, y: 0 },
						// one target is being removed, the other was never declared
						connections: [
							{ blockId: "stored-b", handle: "source" },
							{ blockId: "ghost", handle: "source" },
						],
					},
				],
				canvasChanges: [
					{ type: "block_remove", data: { blocks: ["stored-b"], reason: "unused" } },
				],
			},
			existing,
		);

		expect(result.changes.edges).toEqual([]);
		expect(result.actionsToPerform.blocks).toContainEqual({
			id: "stored-b",
			action: "delete",
		});
	});

	it("re-routes an existing edge in place", () => {
		const existing: CanvasItems = {
			blocks: [
				{ id: "a", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
				{ id: "b", type: "response", data: {}, position: { x: 0, y: 100 } },
				{ id: "c", type: "consolelog", data: {}, position: { x: 0, y: 200 } },
			],
			edges: [
				{ id: "edge-1", from: "a", to: "b", fromHandle: "a-source", toHandle: "b-target" },
			],
		};

		const result = canvasChangesFromPayload(
			{
				targetType: "route",
				targetId: "r-1",
				canvasChanges: [
					{
						type: "edge_swap",
						data: { fromEdge: "a", fromHandle: "source", toEdge: "c", toHandle: "target" },
					},
				],
			},
			existing,
		);

		expect(result.changes.edges).toEqual([
			{ id: "edge-1", from: "a", to: "c", fromHandle: "a-source", toHandle: "c-target" },
		]);
	});
});
