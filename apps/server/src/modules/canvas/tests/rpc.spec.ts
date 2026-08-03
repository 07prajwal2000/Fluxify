import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test";

mock.module("../../../db", () => ({
	db: { transaction: async (cb: any) => await cb(null) },
}));

mock.module("../../../db/redis", () => ({
	publishMessage: async () => {},
	CHAN_ON_ROUTE_CHANGE: "chan:on-route-change",
	CHAN_ON_CUSTOM_BLOCK_CHANGE: "chan:on-custom-block-change",
}));

import * as repository from "../repository";
import { handleCanvasOp } from "../rpc";
import { RpcError } from "../../../db/natsRpc";
import httpSaveRouteCanvas from "../../../api/v1/routes/save-canvas-state/service";

const payload = {
	actionsToPerform: {
		blocks: [{ id: "gone", action: "delete" as const }],
		edges: [],
	},
	changes: {
		blocks: [
			{ id: "b1", type: "entrypoint", data: {}, position: { x: 1, y: 2 } },
			{ id: "b2", type: "response", data: {}, position: { x: 3, y: 4 } },
		],
		edges: [{ id: "e1", from: "b1", to: "b2", fromHandle: "a", toHandle: "b" }],
	},
};

const parentExists = spyOn(repository, "parentExists");
const upsertBlocks = spyOn(repository, "upsertBlocks");
const upsertEdges = spyOn(repository, "upsertEdges");
const getBlocks = spyOn(repository, "getBlocks");

/** everything saveCanvas writes, in order — the observable database state */
const writes = () =>
	[upsertBlocks, upsertEdges].map((spy) => spy.mock.calls[0]?.[0]);

describe("fluxify.ops.canvas responder", () => {
	beforeEach(() => {
		for (const spy of [upsertBlocks, upsertEdges, getBlocks]) spy.mockClear();
		spyOn(repository, "deleteBlocks").mockResolvedValue(undefined);
		spyOn(repository, "deleteEdges").mockResolvedValue(undefined);
		spyOn(repository, "getBlocksCountByType").mockResolvedValue([]);
		spyOn(repository, "touchParent").mockResolvedValue(undefined);
		upsertBlocks.mockResolvedValue(undefined);
		upsertEdges.mockResolvedValue(undefined);
		getBlocks.mockResolvedValue([] as any);
		parentExists.mockResolvedValue(true);
	});

	// the definition of done for #175: two doors, one function
	it("writes exactly what the HTTP endpoint writes for the same payload", async () => {
		await handleCanvasOp(
			{ source: "route", sourceId: "r-1", ...payload },
			{ userId: "u1", projectIds: ["p1"] },
		);
		const viaBus = writes();

		upsertBlocks.mockClear();
		upsertEdges.mockClear();
		await httpSaveRouteCanvas("r-1", payload, [{ projectId: "p1" } as any]);

		expect(writes()).toEqual(viaBus);
	});

	it("reads the canvas back when no changes are given", async () => {
		spyOn(repository, "getEdges").mockResolvedValue([] as any);
		getBlocks.mockResolvedValue([
			{ id: "b1", type: "entrypoint", data: {}, position: { x: 1, y: 2 } },
		] as any);

		const result = await handleCanvasOp(
			{ source: "route", sourceId: "r-1" },
			{ userId: "u1", projectIds: ["p1"] },
		);

		expect((result as any).blocks).toHaveLength(1);
		expect(upsertBlocks).not.toHaveBeenCalled();
	});

	it("fails with PARENT_NOT_FOUND when the parent is not visible", async () => {
		parentExists.mockResolvedValue(false);

		const err = await handleCanvasOp(
			{ source: "route", sourceId: "nope", ...payload },
			{ userId: "u1", projectIds: ["p1"] },
		).catch((e) => e);

		expect(err).toBeInstanceOf(RpcError);
		expect(err.code).toBe("PARENT_NOT_FOUND");
		expect(upsertBlocks).not.toHaveBeenCalled();
	});

	it("rejects an edge pointing at a block that does not exist", async () => {
		const err = await handleCanvasOp(
			{
				source: "route",
				sourceId: "r-1",
				actionsToPerform: { blocks: [], edges: [] },
				changes: {
					blocks: payload.changes.blocks,
					edges: [{ id: "e9", from: "b1", to: "ghost" }],
				},
			},
			{ userId: "u1", projectIds: ["p1"] },
		).catch((e) => e);

		expect(err.code).toBe("VALIDATION_FAILED");
		expect(err.message).toContain("ghost");
		expect(upsertBlocks).not.toHaveBeenCalled();
	});

	it("accepts an edge pointing at an already-stored block", async () => {
		getBlocks.mockResolvedValue([{ id: "stored" }] as any);

		await handleCanvasOp(
			{
				source: "route",
				sourceId: "r-1",
				actionsToPerform: { blocks: [], edges: [] },
				changes: {
					blocks: payload.changes.blocks,
					edges: [{ id: "e9", from: "b1", to: "stored" }],
				},
			},
			{ userId: "u1", projectIds: ["p1"] },
		);

		expect(upsertEdges).toHaveBeenCalled();
	});

	it("rejects a malformed operation with field details", async () => {
		const err = await handleCanvasOp(
			{ source: "nonsense", sourceId: "r-1" },
			{ userId: "u1", projectIds: ["p1"] },
		).catch((e) => e);

		expect(err.code).toBe("VALIDATION_FAILED");
		expect(err.details).toBeTruthy();
	});
});
