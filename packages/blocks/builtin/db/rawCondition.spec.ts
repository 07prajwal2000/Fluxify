import { describe, expect, it } from "bun:test";
import { parseSqlTemplate } from "./rawCondition";

describe("parseSqlTemplate", () => {
	it("splits SQL around each {{ }} expression", () => {
		expect(
			parseSqlTemplate("name ILIKE {{ '%' + q + '%' }} AND age > {{input.age}}"),
		).toEqual({
			strings: ["name ILIKE ", " AND age > ", ""],
			expressions: ["'%' + q + '%'", "input.age"],
		});
	});

	it("keeps SQL without placeholders as one piece", () => {
		expect(parseSqlTemplate("deleted_at IS NULL")).toEqual({
			strings: ["deleted_at IS NULL"],
			expressions: [],
		});
	});

	it("rejects an empty condition or placeholder", () => {
		expect(() => parseSqlTemplate("  ")).toThrow("empty");
		expect(() => parseSqlTemplate("age > {{ }}")).toThrow("empty");
	});
});
