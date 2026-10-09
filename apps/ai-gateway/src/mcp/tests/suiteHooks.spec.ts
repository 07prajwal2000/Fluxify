import { describe, expect, it } from "bun:test";
import { hooksWithIds, suiteWithKeys } from "../suiteHooks";

const get = async (path: string) => {
	expect(path).toBe("/v1/routes/r1/canvas-items");
	return { blocks: [{ id: "id-db", key: "db_insert_1" }, { id: "id-js", key: "jsrunner_1" }] };
};

describe("test suite hooks name blocks by key", () => {
	it("turns keys into ids on the way in, and leaves an id alone", async () => {
		const hooks = await hooksWithIds(get, "route", "r1", [
			{ blockId: "db_insert_1", onBefore: 1 },
			{ blockId: "id-js" },
		]);
		expect(hooks.map((h) => h.blockId)).toEqual(["id-db", "id-js"]);
	});

	it("shows keys on the way out", async () => {
		const suite = await suiteWithKeys(get, {
			routeId: "r1",
			workflowId: null,
			hooks: [{ blockId: "id-db" }],
		});
		expect(suite.hooks).toEqual([{ blockId: "db_insert_1" }]);
	});

	it("reads no canvas when there are no hooks", async () => {
		const never = async () => {
			throw new Error("read");
		};
		expect(await hooksWithIds(never as never, "route", "r1", [])).toEqual([]);
		expect(await suiteWithKeys(never as never, { routeId: "r1", workflowId: null })).toEqual({ routeId: "r1", workflowId: null });
	});
});
