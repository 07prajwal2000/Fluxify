import { describe, expect, it } from "bun:test";
import { matchHooks } from "../hooks";

const script = { kind: "script" as const, value: "return input" };
const hook = (blockId: string, blockType: string, blockName: string) => ({
	blockId,
	blockType,
	blockName,
	onBefore: script,
});

describe("matchHooks", () => {
	it("keeps every hook when cloning onto the same canvas", () => {
		const { kept, dropped } = matchHooks(
			[hook("a", "jsrunner", "calc"), hook("b", "if", "")],
			[
				{ id: "a", type: "jsrunner", name: "calc" },
				{ id: "b", type: "if", name: "" },
			],
		);
		expect(kept.map((h) => h.blockId)).toEqual(["a", "b"]);
		expect(dropped).toEqual([]);
	});

	it("moves a hook to the one block with the same type and name", () => {
		const { kept } = matchHooks(
			[hook("a", "jsrunner", "calc")],
			[
				{ id: "x", type: "jsrunner", name: "calc" },
				{ id: "y", type: "if", name: "calc" },
			],
		);
		expect(kept).toEqual([{ blockId: "x", onBefore: script }]);
	});

	it("drops unnamed, ambiguous, missing and already-taken matches", () => {
		const { kept, dropped } = matchHooks(
			[
				hook("a", "if", ""),
				hook("b", "jsrunner", "twin"),
				hook("c", "jsrunner", "gone"),
				hook("d", "jsrunner", "solo"),
				hook("e", "jsrunner", "solo"),
			],
			[
				{ id: "x", type: "if", name: "" },
				{ id: "t1", type: "jsrunner", name: "twin" },
				{ id: "t2", type: "jsrunner", name: "twin" },
				{ id: "s", type: "jsrunner", name: "solo" },
			],
		);
		expect(kept.map((h) => h.blockId)).toEqual(["s"]);
		expect(dropped).toEqual(["if", "twin", "gone", "solo"]);
	});
});
