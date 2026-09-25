import { describe, expect, it, mock } from "bun:test";

// the canvas as the query sees it: only blocks of the suite's route come back
let routeBlocks: { id: string; type: string }[] = [];
const fakeDb = {
	select: () => ({ from: () => ({ where: async () => routeBlocks }) }),
};
const realDb = { ...(await import("../../../db")) };
mock.module("../../../db", () => ({ ...realDb, db: fakeDb }));

const { validateHooks } = await import("../hooks");

const script = { kind: "script" as const, value: "return input" };
const json = { kind: "json" as const, value: "{}" };

describe("validateHooks", () => {
	routeBlocks = [
		{ id: "run", type: "jsrunner" },
		{ id: "branch", type: "if" },
		{ id: "reply", type: "response" },
	];

	it("accepts any hook on a full block and an input script on a branching one", async () => {
		await validateHooks("r1", [
			{ blockId: "run", onBefore: json, onAfter: script },
			{ blockId: "branch", onBefore: script },
		]);
	});

	it("refuses a block from another route", async () => {
		await expect(validateHooks("r1", [{ blockId: "elsewhere", onBefore: script }])).rejects.toThrow(
			"not on this suite's route",
		);
	});

	it("refuses hooks on the graph frame", async () => {
		await expect(validateHooks("r1", [{ blockId: "reply", onBefore: script }])).rejects.toThrow(
			"cannot have hooks",
		);
	});

	it("refuses a skip or an onAfter on a block that runs other chains", async () => {
		await expect(validateHooks("r1", [{ blockId: "branch", onBefore: json }])).rejects.toThrow(
			"only allows an onBefore script",
		);
		await expect(validateHooks("r1", [{ blockId: "branch", onAfter: script }])).rejects.toThrow(
			"only allows an onBefore script",
		);
	});

	it("refuses two entries for one block", async () => {
		await expect(
			validateHooks("r1", [
				{ blockId: "run", onBefore: script },
				{ blockId: "run", onAfter: script },
			]),
		).rejects.toThrow("only one hook entry");
	});
});
