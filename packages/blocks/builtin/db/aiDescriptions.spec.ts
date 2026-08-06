import { describe, expect, it } from "bun:test";
import { deleteDbAiDescription } from "./delete";
import { getAllDbAiDescription } from "./getAll";
import { getSingleDbAiDescription } from "./getSingle";
import { dbWhereConditionsDescription } from "./schema";
import { whereConditionSchema } from "./schema";
import { updateDbAiDescription } from "./update";

describe("DB AI descriptions", () => {
	it("requires DB WHERE condition objects for every condition-capable block", () => {
		const descriptions = [
			getAllDbAiDescription,
			getSingleDbAiDescription,
			updateDbAiDescription,
			deleteDbAiDescription,
		];

		for (const description of descriptions) {
			const schema = JSON.parse(description.jsonSchema);
			expect(schema.properties.conditions).toMatchObject({
				type: "array",
				description: dbWhereConditionsDescription,
			});
			expect(schema.properties.conditions.items).toBeDefined();
		}
	});
});

describe("whereConditionSchema", () => {
	it("requires tagged operands and a column reference", () => {
		expect(
			whereConditionSchema.safeParse({
				attribute: "status",
				operator: "eq",
				value: "active",
				chain: "and",
			}).success,
		).toBe(false);
		expect(
			whereConditionSchema.safeParse({
				attribute: { kind: "literal", value: 1 },
				operator: "eq",
				value: { kind: "literal", value: 1 },
				chain: "and",
			}).success,
		).toBe(false);
		expect(
			whereConditionSchema.safeParse({
				attribute: { kind: "column", value: "status" },
				operator: "eq",
				value: { kind: "literal", value: "active" },
				chain: "and",
			}).success,
		).toBe(true);
	});
});
