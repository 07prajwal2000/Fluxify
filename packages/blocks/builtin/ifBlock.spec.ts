import { describe, expect, it } from "bun:test";
import { ifBlockSchema } from "./if";

const parse = (condition: object) => ifBlockSchema.safeParse({ conditions: [condition] });

describe("if block conditions", () => {
	it("js needs neither lhs nor rhs", () => {
		expect(parse({ operator: "js", js: "return input.ok" }).success).toBe(true);
	});

	it("is_empty and is_not_empty need no rhs", () => {
		expect(parse({ operator: "is_empty", lhs: "js:return input" }).success).toBe(true);
		expect(parse({ operator: "is_not_empty", lhs: "js:return input" }).success).toBe(true);
	});

	it("comparisons still need both sides", () => {
		expect(parse({ operator: "eq", lhs: 1 }).success).toBe(false);
		expect(parse({ operator: "gte", rhs: 1 }).success).toBe(false);
		expect(parse({ operator: "eq", lhs: 1, rhs: 1 }).success).toBe(true);
	});

	it("is_empty still needs lhs", () => {
		expect(parse({ operator: "is_empty" }).success).toBe(false);
	});
});
