import { expect, it } from "bun:test";
import { isVisible, type VisibleWhenInput } from "../index.js";

it("matches a value, any of a list, and every key of one object", () => {
	expect(isVisible({ mode: "advanced" }, { mode: "advanced" })).toBe(true);
	expect(isVisible({ mode: "advanced" }, { mode: "simple" })).toBe(false);
	expect(isVisible({ mode: ["a", "b"] }, { mode: "b" })).toBe(true);
	expect(isVisible({ mode: "a", on: true }, { mode: "a", on: false })).toBe(false);
	expect(isVisible({ mode: "a" }, {})).toBe(false);
});

it("groups with all and any", () => {
	const when: VisibleWhenInput = { any: [{ all: [{ a: 1 }, { b: true }] }, { c: "x" }] };
	expect(isVisible(when, { a: 1, b: true })).toBe(true);
	expect(isVisible(when, { a: 1 })).toBe(false);
	expect(isVisible(when, { c: "x" })).toBe(true);
});
