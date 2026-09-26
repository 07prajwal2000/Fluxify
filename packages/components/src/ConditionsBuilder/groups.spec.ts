import { describe, expect, test } from "bun:test";
import type { Condition } from "./types";
import {
	conditionsAt,
	countIncomplete,
	formatConditionsSummary,
	validPath,
	withConditionsAt,
} from "./utils";

const eq = (lhs: string, rhs: string, chain: "and" | "or" = "and"): Condition => ({
	lhs: { kind: "column", value: lhs },
	rhs: { kind: "literal", value: rhs },
	operator: "eq",
	chain,
});
const group = (items: Condition[], chain: "and" | "or" = "and"): Condition => ({
	lhs: "",
	rhs: "",
	operator: "eq",
	chain,
	group: items,
});

// a AND ( b OR ( c AND d ) )
const tree = [eq("a", "1"), group([eq("b", "2"), group([eq("c", "3"), eq("d", "4")], "or")])];

describe("group navigation", () => {
	test("a path leads to the list inside the open group", () => {
		expect(conditionsAt(tree, [1, 1])).toEqual([eq("c", "3"), eq("d", "4")]);
	});

	test("a path through a deleted or non-group item stops at the last real group", () => {
		expect(validPath(tree, [1, 1])).toEqual([1, 1]);
		expect(validPath(tree, [1, 5])).toEqual([1]);
		// index 0 is a plain condition, not a group
		expect(validPath(tree, [0, 2])).toEqual([]);
		expect(validPath([], [3])).toEqual([]);
	});

	test("an edit deep down replaces only that list and leaves the input untouched", () => {
		const before = structuredClone(tree);
		const next = withConditionsAt(tree, [1, 1], [eq("z", "9")]);
		expect(conditionsAt(next, [1, 1])).toEqual([eq("z", "9")]);
		expect(next[0]).toBe(tree[0]);
		expect(conditionsAt(next, [1])[0]).toBe(conditionsAt(tree, [1])[0]);
		expect(tree).toEqual(before);
	});
});

describe("group summary", () => {
	test("brackets every group, at any depth", () => {
		expect(formatConditionsSummary(tree)).toBe("a = 1 AND ( b = 2 OR ( c = 3 AND d = 4 ) )");
		expect(formatConditionsSummary([eq("a", "1"), group([], "or")])).toBe("a = 1 OR ( )");
	});

	test("counts what is left to fill inside, an empty group as one", () => {
		expect(countIncomplete(tree)).toBe(0);
		const holes = [
			eq("", "1"),
			group([eq("b", ""), group([]), { ...eq("c", ""), operator: "is_null" }]),
			{ ...eq("", ""), operator: "raw" as const, raw: "js:" },
		];
		expect(countIncomplete(holes)).toBe(4);
	});
});
