import { describe, expect, it } from "bun:test";
import {
	canvasAfterChanges,
	canvasChangesFromPayload,
	type CanvasItems,
} from "../canvasNormalize";

const EMPTY: CanvasItems = { blocks: [], edges: [] };

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

		// index 0 is the entrypoint filled in for this new canvas
		const [, first, second] = result.changes.blocks;
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

		expect(result.actionsToPerform.blocks).toEqual(
			result.changes.blocks.map((b) => ({ id: b.id, action: "upsert" })),
		);
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

	it("remaps a declared entrypoint/errorHandler onto the stored singleton instead of minting a duplicate", () => {
		const existing: CanvasItems = {
			blocks: [
				{ id: "stored-entry", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
				{ id: "stored-err", type: "error_handler", data: {}, position: { x: -100, y: 0 } },
				{ id: "stored-response", type: "response", data: {}, position: { x: 0, y: 100 } },
			],
			edges: [],
		};

		const result = canvasChangesFromPayload(
			{
				targetType: "route",
				targetId: "r-1",
				blocks: [
					{
						id: "agent_entry",
						blockType: "entrypoint",
						position: { x: 0, y: 0 },
						connections: [{ blockId: "stored-response", handle: "source" }],
					},
					{
						id: "agent_err",
						blockType: "errorHandler",
						position: { x: -100, y: 0 },
						connections: [],
					},
				],
			},
			existing,
		);

		const ids = result.changes.blocks.map((b) => b.id);
		expect(ids).toContain("stored-entry");
		expect(ids).toContain("stored-err");
		expect(ids).not.toContain("agent_entry");
		expect(ids).not.toContain("agent_err");
		expect(result.changes.blocks.filter((b) => b.type === "entrypoint")).toHaveLength(1);
		expect(result.changes.blocks.filter((b) => b.type === "error_handler")).toHaveLength(1);
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

	it("replaces a changed block's stale edge on the same handle", () => {
		const existing: CanvasItems = {
			blocks: [
				{ id: "a", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
				{ id: "b", type: "response", data: {}, position: { x: 0, y: 100 } },
				{ id: "c", type: "consolelog", data: {}, position: { x: 0, y: 200 } },
			],
			edges: [
				{ id: "edge-old", from: "a", to: "b", fromHandle: "a-source", toHandle: "b-target" },
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
									id: "a",
									blockType: "entrypoint",
									position: { x: 0, y: 0 },
									connections: [{ blockId: "c", handle: "source" }],
								},
							],
						},
					},
				],
			},
			existing,
		);

		expect(result.actionsToPerform.edges).toContainEqual({
			id: "edge-old",
			action: "delete",
		});
		expect(canvasAfterChanges(existing, result).edges).toEqual([
			expect.objectContaining({ from: "a", to: "c", fromHandle: "a-source" }),
		]);
	});

	it("adds the entrypoint and error handler the agent omitted on a new canvas", () => {
		const result = canvasChangesFromPayload(
			{
				targetType: "custom_block",
				targetId: "cb-1",
				blocks: [
					{
						id: "block_1",
						blockType: "consolelog",
						position: { x: 192, y: 0 },
						connections: [],
					},
				],
			},
			{ blocks: [], edges: [] },
		);

		const entry = result.changes.blocks.find((b) => b.type === "entrypoint");
		const handler = result.changes.blocks.find((b) => b.type === "error_handler");
		expect(entry).toBeDefined();
		expect(handler).toBeDefined();
		// the entrypoint has to actually reach the graph, not just exist
		expect(result.changes.edges).toHaveLength(1);
		expect(result.changes.edges[0].from).toBe(entry!.id);
		expect(
			result.actionsToPerform.blocks.map((b) => b.id).sort(),
		).toEqual(result.changes.blocks.map((b) => b.id).sort());
	});

	it("leaves an existing canvas's structural blocks alone", () => {
		const result = canvasChangesFromPayload(
			{
				targetType: "route",
				targetId: "r-1",
				blocks: [
					{ id: "block_1", blockType: "consolelog", position: { x: 0, y: 0 }, connections: [] },
				],
			},
			{
				blocks: [{ id: "stored-entry", type: "entrypoint", data: {}, position: { x: 0, y: 0 } }],
				edges: [],
			},
		);
		expect(result.changes.blocks.map((b) => b.type)).toEqual(["consolelog"]);
	});
});
