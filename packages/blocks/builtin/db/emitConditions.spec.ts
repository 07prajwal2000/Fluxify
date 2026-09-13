import { describe, expect, it } from "bun:test";
import type { EmitNode } from "../../compiler";
import { emitWhereConditions } from "./emitConditions";
import type { whereConditionSchema } from "./schema";
import z from "zod";

type WhereCondition = z.infer<typeof whereConditionSchema>;

function createNode() {
	const values: unknown[] = [];
	const node = {
		in: "$in",
		value(value: unknown) {
			values.push(value);
			return typeof value === "string" && value.startsWith("js:")
				? `(${value.slice(3)})`
				: JSON.stringify(value);
		},
		js(code: string, extras: string) {
			return `js(${code}, ${extras})`;
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

	it("emits a custom SQL condition as baked-in text plus evaluated values", () => {
		const { node } = createNode();
		const conditions: WhereCondition[] = [
			{ operator: "raw", raw: "name ILIKE {{ getQueryParam('q') }}", chain: "or" },
		];

		expect(emitWhereConditions(conditions, node)).toBe(
			`[{ operator: "raw", raw: { strings: ["name ILIKE ",""], values: [js(return (getQueryParam('q'));, $in)] }, chain: "or" }]`,
		);
	});

	it("emits a custom js: condition through node.value", () => {
		const { node, values } = createNode();
		const conditions: WhereCondition[] = [
			{ operator: "raw", raw: "js:return { age: 1 }", chain: "and" },
		];

		expect(emitWhereConditions(conditions, node)).toBe(
			`[{ operator: "raw", raw: (return { age: 1 }), chain: "and" }]`,
		);
		expect(values).toEqual(["js:return { age: 1 }"]);
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
