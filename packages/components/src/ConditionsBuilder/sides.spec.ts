import { describe, expect, test } from "bun:test";
import { encodeSide, sideIsColumn, toggleSideMode } from "./utils";

describe("sideIsColumn", () => {
	test("an untagged side falls back to what that side used to mean", () => {
		// only for graphs written before the tags existed: an attribute was a
		// column by position, a value was a literal, so a dotted string like an
		// email address was never read as a column path
		expect(sideIsColumn("email", "lhs")).toBe(true);
		expect(sideIsColumn("ada@example.com", "rhs")).toBe(false);
	});

	test("a tag overrides the default on either side", () => {
		expect(sideIsColumn({ kind: "literal", value: 18 }, "lhs")).toBe(false);
		expect(sideIsColumn({ kind: "column", value: "age" }, "rhs")).toBe(true);
	});

	test("an empty side keeps its default", () => {
		expect(sideIsColumn(undefined, "lhs")).toBe(true);
		expect(sideIsColumn(undefined, "rhs")).toBe(false);
	});
});

describe("toggleSideMode", () => {
	test("clears the field rather than carrying text across modes", () => {
		expect(toggleSideMode("email", "lhs")).toEqual({ kind: "literal", value: "" });
		expect(toggleSideMode("ada@example.com", "rhs")).toEqual({
			kind: "column",
			value: "",
		});
	});

	test("toggling back returns to the other mode, still tagged", () => {
		expect(toggleSideMode({ kind: "literal", value: "18" }, "lhs")).toEqual({
			kind: "column",
			value: "",
		});
		expect(toggleSideMode({ kind: "column", value: "age" }, "rhs")).toEqual({
			kind: "literal",
			value: "",
		});
	});

	test("a js expression is not carried into the other mode", () => {
		expect(toggleSideMode("js:return 1;", "lhs")).toEqual({
			kind: "literal",
			value: "",
		});
	});
});

describe("encodeSide", () => {
	test("always tags, so both sides emit the same two shapes", () => {
		// the confusing part of the old encoding: the same toggle produced a tag
		// on one side and a bare string on the other
		expect(encodeSide("email", "users.id", "lhs")).toEqual({
			kind: "column",
			value: "email",
		});
		expect(encodeSide("ada@example.com", "", "rhs")).toEqual({
			kind: "literal",
			value: "ada@example.com",
		});
	});

	test("keeps typed text in the mode the side is already in", () => {
		expect(encodeSide("18", { kind: "literal", value: "" }, "lhs")).toEqual({
			kind: "literal",
			value: "18",
		});
		expect(encodeSide("age", { kind: "column", value: "" }, "rhs")).toEqual({
			kind: "column",
			value: "age",
		});
	});

	test("a tagged side reads the same from either side", () => {
		for (const side of ["lhs", "rhs"] as const) {
			expect(sideIsColumn({ kind: "column", value: "x" }, side)).toBe(true);
			expect(sideIsColumn({ kind: "literal", value: "x" }, side)).toBe(false);
		}
	});

	test("round-trips with sideIsColumn for both sides", () => {
		for (const side of ["lhs", "rhs"] as const) {
			for (const seed of [undefined, toggleSideMode(undefined, side)]) {
				const encoded = encodeSide("x", seed, side);
				expect(sideIsColumn(encoded, side)).toBe(sideIsColumn(seed, side));
			}
		}
	});
});
