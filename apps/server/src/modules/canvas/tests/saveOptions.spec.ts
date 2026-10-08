import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

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
	CHAN_ON_WORKFLOW_CHANGE: "chan:on-workflow-change",
}));

import { BadRequestError } from "../../../errors/badRequestError";
import { ConflictError } from "../../../errors/conflictError";
import * as repository from "../repository";
import { saveCanvas } from "../service";

const route = { type: "route" as const, id: "r-1" };

/** one block and one edge to an already-stored block */
const save = (
	edge: Record<string, unknown> = {},
	type = "response",
	data: unknown = { httpCode: "200" },
) => ({
	actionsToPerform: {
		blocks: [{ id: "b1", action: "upsert" as const }],
		edges: [{ id: "e1", action: "upsert" as const }],
	},
	changes: {
		blocks: [{ id: "b1", type, data, position: { x: 0, y: 0 } }],
		edges: [
			{ id: "e1", from: "entry", to: "b1", fromHandle: "entry-source", toHandle: "b1-target", ...edge },
		],
	},
});

const touchParent = spyOn(repository, "touchParent");
const upsertBlocks = spyOn(repository, "upsertBlocks");

describe("saveCanvas options (#597)", () => {
	beforeEach(() => {
		published.length = 0;
		spyOn(repository, "parentExists").mockResolvedValue(true);
		spyOn(repository, "getBlocks").mockResolvedValue([{ id: "entry", type: "entrypoint" }] as any);
		spyOn(repository, "getEdges").mockResolvedValue([]);
		spyOn(repository, "getBlocksCountByType").mockResolvedValue([]);
		spyOn(repository, "getCustomBlockNames").mockResolvedValue([]);
		spyOn(repository, "getProjectCustomBlocks").mockResolvedValue([]);
		spyOn(repository, "getCustomBlockCalls").mockResolvedValue([]);
		for (const name of ["upsertEdges", "deleteBlocks", "deleteEdges"] as const) {
			spyOn(repository, name).mockResolvedValue(undefined);
		}
		upsertBlocks.mockClear();
		upsertBlocks.mockResolvedValue(undefined);
		touchParent.mockClear();
		touchParent.mockResolvedValue(4);
	});

	it("bumps the version in the save and returns it", async () => {
		const result = await saveCanvas(route, save(), ["p1"]);
		expect(result).toEqual({ canvasVersion: 4, issues: [] });
		expect(touchParent.mock.calls[0][2]).toBeUndefined();
		expect(published).toEqual(["chan:on-route-change"]);
	});

	it("passes the expected version down and refuses a stale one", async () => {
		touchParent.mockResolvedValue(undefined);
		await expect(saveCanvas(route, save(), ["p1"], undefined, false, { expectedVersion: 2 })).rejects.toThrow(
			ConflictError,
		);
		expect(touchParent.mock.calls[0][2]).toBe(2);
		expect(published).toEqual([]);
	});

	it.each([
		["null", null],
		["empty", ""],
		["blank", "  "],
		["missing", undefined],
	])("refuses a %s handle before touching storage", async (_name, handle) => {
		await expect(saveCanvas(route, save({ fromHandle: handle }), ["p1"])).rejects.toThrow(BadRequestError);
		await expect(saveCanvas(route, save({ toHandle: handle }), ["p1"])).rejects.toThrow(BadRequestError);
		expect(upsertBlocks).not.toHaveBeenCalled();
	});

	it("a dry run checks, returns the issues and the current version, and publishes nothing", async () => {
		const workflow = { type: "workflow" as const, id: "w-1" };
		const result = await saveCanvas(workflow, save(), ["p1"], undefined, false, { dryRun: true });
		expect(result.canvasVersion).toBe(3);
		expect(result.issues).toEqual([
			expect.objectContaining({ severity: "warning", blockId: "b1" }),
		]);
		expect(published).toEqual([]);
	});

	it("a dry run reports a rule error instead of throwing it", async () => {
		spyOn(repository, "getProjectCustomBlocks").mockResolvedValue([
			{ id: "cb", name: "auth_mw", usage: "middleware" },
		]);
		spyOn(repository, "getCustomBlockNames").mockResolvedValue(["auth_mw"]);
		await expect(saveCanvas(route, save({}, "auth_mw"), ["p1"])).rejects.toThrow("middleware block");
		const result = await saveCanvas(route, save({}, "auth_mw"), ["p1"], undefined, false, {
			dryRun: true,
		});
		expect(result.issues[0]).toMatchObject({ severity: "error", blockId: "b1" });
	});

	it("refuses block data that does not match its schema, naming the block and field (#673)", async () => {
		const bad = save({}, "response", { httpCode: "200", transformEnabled: "yes" });
		await expect(saveCanvas(route, bad, ["p1"])).rejects.toThrow(
			"response: transformEnabled must be a boolean",
		);
		expect(upsertBlocks).not.toHaveBeenCalled();
		expect(published).toEqual([]);
		// a dry run reports it instead
		const result = await saveCanvas(route, bad, ["p1"], undefined, false, { dryRun: true });
		expect(result.issues).toEqual([
			{ severity: "error", blockId: "b1", message: "response: transformEnabled must be a boolean" },
		]);
	});
});
