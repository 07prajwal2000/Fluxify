import { describe, expect, test } from "bun:test";
import {
	parseDbConditions,
	readDbBinding,
	serializeDbConditions,
} from "./conditions";
import type { BlockNode } from "../../../types";

function block(data: Record<string, unknown>) {
	return { id: "b1", data } as unknown as BlockNode;
}

describe("db condition round trip", () => {
	test("a column reference survives load and save", () => {
		const stored = [
			{
				attribute: "email",
				operator: "eq" as const,
				value: { kind: "column" as const, value: "backup_email" },
				chain: "and" as const,
			},
		];

		const parsed = parseDbConditions(block({ conditions: stored }));
		expect(parsed[0].rhs).toEqual({ kind: "column", value: "backup_email" });

		// the regression this guards: String()-ing the value here wrote
		// "[object Object]" back to the graph the next time the panel saved
		expect(serializeDbConditions(parsed)).toEqual([
			{
				attribute: { kind: "column", value: "email" },
				operator: "eq",
				value: { kind: "column", value: "backup_email" },
				chain: "and",
			},
		]);
	});

	test("a literal attribute survives load and save", () => {
		const stored = [
			{
				attribute: { kind: "literal" as const, value: 18 },
				operator: "lte" as const,
				value: { kind: "column" as const, value: "age" },
				chain: "and" as const,
			},
		];

		const parsed = parseDbConditions(block({ conditions: stored }));
		expect(parsed[0].lhs).toEqual({ kind: "literal", value: 18 });
		expect(serializeDbConditions(parsed)).toEqual(stored);
	});

	test("normalizes an untagged attribute to a column object on save", () => {
		const parsed = parseDbConditions(
			block({ conditions: [{ attribute: "email", operator: "eq", value: "x" }] }),
		);

		expect(parsed[0].lhs).toBe("email");
		expect(serializeDbConditions(parsed)[0].attribute).toEqual({
			kind: "column",
			value: "email",
		});
	});

	test("a dotted literal stays a literal", () => {
		const parsed = parseDbConditions(
			block({
				conditions: [
					{
						attribute: "email",
						operator: "eq",
						value: "ada@example.com",
						chain: "and",
					},
				],
			}),
		);

		expect(parsed[0].rhs).toBe("ada@example.com");
		expect(serializeDbConditions(parsed)[0].value).toEqual({
			kind: "literal",
			value: "ada@example.com",
		});
	});

	test("reads the builder's own lhs/rhs spelling", () => {
		const parsed = parseDbConditions(
			block({ conditions: [{ lhs: "id", rhs: 7, operator: "gt" }] }),
		);

		expect(parsed[0]).toEqual({
			chain: "and",
			lhs: "id",
			rhs: 7,
			operator: "gt",
		});
	});

	test("defaults a missing operator to a valid one", () => {
		// "equal_to" used to be the fallback, which is not a ConditionOperator
		const parsed = parseDbConditions(
			block({ conditions: [{ attribute: "id", value: 1 }] }),
		);
		expect(parsed[0].operator).toBe("eq");
	});

	test("no conditions is an empty list, not a throw", () => {
		expect(parseDbConditions(block({}))).toEqual([]);
	});
	test("nested groups survive load and save, empty ones included", () => {
		const eq = (column: string, chain: "and" | "or") => ({
			attribute: { kind: "column", value: column },
			operator: "eq",
			value: { kind: "literal", value: 1 },
			chain,
		});
		const stored = [
			eq("a", "and"),
			{
				group: [
					eq("b", "and"),
					{ group: [{ operator: "raw", raw: "c > {{ input.c }}", chain: "and" }, eq("d", "or")], chain: "or" },
					{ group: [], chain: "and" },
				],
				chain: "or",
			},
		];

		const parsed = parseDbConditions(block({ conditions: stored }));
		expect(parsed[1].group?.[1].group?.[1].lhs).toEqual({ kind: "column", value: "d" });
		expect(serializeDbConditions(parsed)).toEqual(stored as never);
	});
});

describe("readDbBinding", () => {
	test("prefers the canonical field names", () => {
		expect(
			readDbBinding(block({ connection: "a", integration: "b", tableName: "t" })),
		).toEqual({ connectionId: "a", tableName: "t" });
	});

	test("falls back through the older spellings", () => {
		expect(readDbBinding(block({ integrationId: "c", table: "u" }))).toEqual({
			connectionId: "c",
			tableName: "u",
		});
	});

	test("is empty when the block is unbound", () => {
		expect(readDbBinding(block({}))).toEqual({
			connectionId: "",
			tableName: "",
		});
	});
});
