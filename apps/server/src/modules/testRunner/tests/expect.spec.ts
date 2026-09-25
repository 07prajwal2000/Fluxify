import { describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import type { AssertionResult } from "../../../db/schema";
import { createExpect } from "../expect";

const collect = () => {
	const results: AssertionResult[] = [];
	return { results, t: createExpect((r) => results.push(r)) };
};

describe("createExpect", () => {
	it("records a line per check and never throws", () => {
		const { results, t } = collect();
		t(1).toBe(1);
		t(1).toBe(2);
		t({ a: [1, { b: 2 }] }).toEqual({ a: [1, { b: 2 }] });
		t({ a: 1 }).toEqual({ a: 1, b: 2 });
		t("").toBeFalsy();
		t(0).toBeTruthy();
		t(null).toBeNull();
		t(undefined).toBeUndefined();
		t(0).toBeDefined();
		t([1, 2]).toContain(2);
		t("hello").toContain("ell");
		t([1, 2]).toHaveLength(2);
		t({ a: { b: [0, 5] } }).toHaveProperty("a.b[1]", 5);
		t({ a: undefined }).toHaveProperty("a");
		t({}).toHaveProperty("a");
		t("abc").toMatch(/b/);
		t("abc").toMatch("bc");
		t(5).toBeGreaterThan(4);
		t(5).toBeLessThan(4);
		t(new Date(1)).toEqual(new Date(2));
		expect(results.map((r) => r.success)).toEqual([
			true, false, true, false, true, false, true, true, true, true, true, true, true, true, false,
			true, true, true, false, false,
		]);
	});

	it("inverts with .not and prefixes the label", () => {
		const { results, t } = collect();
		t(500, "status").not.toBe(500);
		t([1]).not.toContain(2);
		expect(results).toEqual([
			{ success: false, message: "status: expected 500 not to be 500" },
			{ success: true, message: "expected [1] not to contain 2 ✓" },
		]);
	});

	it("compares values made in another realm, as custom JS in the vm does", () => {
		const { results, t } = collect();
		runInNewContext(`t([1, { a: "x" }]).toEqual([1, { a: "x" }]); t("abc").toMatch(/c$/);`, { t });
		expect(results.every((r) => r.success)).toBe(true);
	});
});
