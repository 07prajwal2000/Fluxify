import { describe, expect, it } from "bun:test";
import type { EmitNode } from "../../compiler";
import { emitWhereConditions } from "./emitConditions";
import type { whereConditionSchema } from "./schema";
import z from "zod";

type WhereCondition = z.infer<typeof whereConditionSchema>;

function createNode() {
	const values: unknown[] = [];
	const node = {
		value(value: unknown) {
			values.push(value);
			return typeof value === "string" && value.startsWith("js:")
				? `(${value.slice(3)})`
				: JSON.stringify(value);
		},
	} as unknown as EmitNode;
	return { node, values };
}

describe("emitWhereConditions", () => {
	it("emits empty conditions as an array literal", () => {
		const { node, values } = createNode();

		expect(emitWhereConditions([], node)).toBe("[]");
		expect(values).toEqual([]);
	});

	it("serializes literal sides, operators, chains, and special characters", () => {
		const { node, values } = createNode();
		const conditions: WhereCondition[] = [
			{ attribute: { kind: "column", value: "profile.email" }, operator: "eq", value: { kind: "literal", value: 'ada"@example.com' }, chain: "and" },
			{ attribute: { kind: "column", value: "age" }, operator: "gte", value: { kind: "literal", value: 21 }, chain: "or" },
		];

		expect(emitWhereConditions(conditions, node)).toBe(
			'[{ attribute: { "kind": "column", "value": "profile.email" }, operator: "eq", value: { "kind": "literal", "value": "ada\\\"@example.com" }, chain: "and" }, { attribute: { "kind": "column", "value": "age" }, operator: "gte", value: { "kind": "literal", "value": 21 }, chain: "or" }]',
		);
		expect(values).toEqual([
			"column",
			"profile.email",
			"literal",
			'ada"@example.com',
			"column",
			"age",
			"literal",
		]);
	});

	it("inlines js-prefixed untagged sides through node.value", () => {
		const { node, values } = createNode();
		const conditions: WhereCondition[] = [
			{
				attribute: { kind: "column", value: "js:return input.field" },
				operator: "eq",
				value: { kind: "literal", value: "js:return input.id" },
				chain: "and",
			},
		];

		expect(emitWhereConditions(conditions, node)).toBe(
			"[{ attribute: { \"kind\": \"column\", \"value\": (return input.field) }, operator: \"eq\", value: { \"kind\": \"literal\", \"value\": (return input.id) }, chain: \"and\" }]",
		);
		expect(values).toEqual([
			"column",
			"js:return input.field",
			"literal",
			"js:return input.id",
		]);
	});

	it("recursively emits js inside tagged column and literal sides", () => {
		const { node, values } = createNode();
		const conditions: WhereCondition[] = [
			{
				attribute: { kind: "literal", value: "js:return input.id" },
				operator: "eq",
				value: { kind: "column", value: "users.id" },
				chain: "and",
			},
		];

		expect(emitWhereConditions(conditions, node)).toBe(
			'[{ attribute: { "kind": "literal", "value": (return input.id) }, operator: "eq", value: { "kind": "column", "value": "users.id" }, chain: "and" }]',
		);
		expect(values).toEqual([
			"literal",
			"js:return input.id",
			"column",
			"users.id",
		]);
		expect(conditions[0]).toEqual({
			attribute: { kind: "literal", value: "js:return input.id" },
			operator: "eq",
			value: { kind: "column", value: "users.id" },
			chain: "and",
		});
	});
});
