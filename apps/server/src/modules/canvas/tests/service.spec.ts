import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test";

mock.module("../../../db", () => ({
	db: { transaction: async (cb: any) => await cb(null) },
}));

const published: string[] = [];
mock.module("../../../db/redis", () => ({
	publishMessage: async (chan: string) => {
		published.push(chan);
	},
	CHAN_ON_ROUTE_CHANGE: "chan:on-route-change",
	CHAN_ON_CUSTOM_BLOCK_CHANGE: "chan:on-custom-block-change",
}));

import * as repository from "../repository";
import { saveCanvas } from "../service";
import { NotFoundError } from "../../../errors/notFoundError";
import { ConflictError } from "../../../errors/conflictError";

const changes = {
	actionsToPerform: {
		blocks: [{ id: "gone", action: "delete" as const }],
		edges: [{ id: "oldEdge", action: "delete" as const }],
	},
	changes: {
		blocks: [
			{ id: "b1", type: "entrypoint", data: {}, position: { x: 1, y: 2 } },
		],
		edges: [
			{ id: "e1", from: "b1", to: "b2", fromHandle: "a", toHandle: "b" },
		],
	},
};

const parentExists = spyOn(repository, "parentExists");
const upsertBlocks = spyOn(repository, "upsertBlocks");
const upsertEdges = spyOn(repository, "upsertEdges");
const delBlocks = spyOn(repository, "deleteBlocks");
const delEdges = spyOn(repository, "deleteEdges");
const getEdges = spyOn(repository, "getEdges");

describe("canvas saveCanvas", () => {
	beforeEach(() => {
		published.length = 0;
		spyOn(repository, "getBlocksCountByType").mockResolvedValue([]);
		// e1 points at b2, which the fixture leaves already stored
		spyOn(repository, "getBlocks").mockResolvedValue([{ id: "b2" }] as any);
		getEdges.mockResolvedValue([] as any);
		spyOn(repository, "touchParent").mockResolvedValue(undefined);
		for (const spy of [upsertBlocks, upsertEdges, delBlocks, delEdges]) {
			spy.mockClear();
			spy.mockResolvedValue(undefined);
		}
		parentExists.mockResolvedValue(true);
	});

	it("writes a custom block canvas through the custom_block foreign key", async () => {
		await saveCanvas({ type: "custom_block", id: "cb-1" }, changes, ["p1"]);

		// positions and edges survive for a custom block — they used to be dropped
		expect(upsertBlocks.mock.calls[0][0]).toEqual([
			{
				id: "b1",
				type: "entrypoint",
				data: {},
				position: { x: 1, y: 2 },
				routeId: null,
				customBlockId: "cb-1",
			},
		]);
		expect(upsertEdges.mock.calls[0][0][0]).toMatchObject({
			id: "e1",
			routeId: null,
			customBlockId: "cb-1",
		});
		expect(delBlocks.mock.calls[0][0]).toEqual(["gone"]);
		expect(delEdges.mock.calls[0][0]).toEqual(["oldEdge"]);
		expect(published).toEqual(["chan:on-custom-block-change"]);
	});

	it("writes a route canvas through the route foreign key", async () => {
		await saveCanvas({ type: "route", id: "r-1" }, changes, ["p1"]);

		expect(upsertBlocks.mock.calls[0][0][0]).toMatchObject({
			routeId: "r-1",
			customBlockId: null,
		});
		expect(published).toEqual(["chan:on-route-change"]);
	});

	it("refuses to touch a canvas whose parent is not visible", async () => {
		parentExists.mockResolvedValue(false);

		await expect(
			saveCanvas({ type: "route", id: "nope" }, changes, ["p1"]),
		).rejects.toThrow(NotFoundError);
		expect(upsertBlocks).not.toHaveBeenCalled();
	});

	it.each(["route", "custom_block"] as const)(
		"rejects a cycle for a %s canvas before it writes",
		async (type) => {
			const loop = {
				actionsToPerform: { blocks: [], edges: [] },
				changes: {
					blocks: [
						{ id: "if", type: "if", data: {}, position: { x: 1, y: 1 } },
						{ id: "db", type: "db_getall", data: {}, position: { x: 2, y: 2 } },
					],
					edges: [
						{ id: "false", from: "if", to: "db", fromHandle: "false", toHandle: "" },
						{ id: "back", from: "db", to: "if", fromHandle: "", toHandle: "" },
					],
				},
			};

			await expect(saveCanvas({ type, id: "parent-1" }, loop, ["p1"])).rejects.toThrow(
				ConflictError,
			);
			expect(upsertBlocks).not.toHaveBeenCalled();
			expect(upsertEdges).not.toHaveBeenCalled();
		},
	);

	it("rejects a newly-added return edge that closes a stored path", async () => {
		spyOn(repository, "getBlocks").mockResolvedValue([
			{ id: "if" },
			{ id: "db" },
		] as any);
		getEdges.mockResolvedValue([
			{ id: "false", from: "if", to: "db", fromHandle: "false", toHandle: "" },
		] as any);

		await expect(
			saveCanvas(
				{ type: "route", id: "r-1" },
				{
					actionsToPerform: { blocks: [], edges: [] },
					changes: {
						blocks: [],
						edges: [
							{ id: "back", from: "db", to: "if", fromHandle: "", toHandle: "" },
						],
					},
				},
				["p1"],
			),
		).rejects.toThrow(ConflictError);
		expect(upsertEdges).not.toHaveBeenCalled();
	});
});
