import { describe, expect, test } from "bun:test";
import { hookErrors, hookTypes, slotsFor } from "./hooks";

describe("hooks", () => {
	test("offers the hooks each block kind allows, as the server checks", () => {
		expect(slotsFor("full").map((s) => s.slot)).toEqual(["onBefore", "onAfter"]);
		expect(slotsFor("input")).toEqual([{ slot: "onBefore", json: false }]);
		expect(slotsFor("none")).toEqual([]);
	});

	test("flags JSON that does not parse", () => {
		const errors = hookErrors([
			{ blockId: "a", onBefore: { kind: "json", value: "{" } },
			{ blockId: "b", onAfter: { kind: "json", value: '{"ok":1}' } },
			{ blockId: "c", onBefore: { kind: "script", value: "{" } },
		]);
		expect([...errors.keys()]).toEqual(["a"]);
	});

	test("types t.skip with the block's own branches, only before it runs", () => {
		expect(hookTypes("onBefore", "db_exists")).toContain('branch?: "success" | "failure"');
		expect(hookTypes("onAfter", "db_exists")).not.toContain("skip(");
		expect(hookTypes("onAfter", "jsrunner")).toContain("declare const output");
	});
});
