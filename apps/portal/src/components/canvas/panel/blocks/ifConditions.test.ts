import { expect, test } from "bun:test";
import { parseIfConditions, serializeIfConditions } from "./ifConditions";
import type { BlockNode } from "../../types";

function block(conditions: unknown[]) {
	return { id: "if-1", data: { conditions } } as unknown as BlockNode;
}

test("if conditions read legacy DB-shaped data as plain server values", () => {
	expect(
		parseIfConditions(
			block([
				{
					attribute: { kind: "column", value: "status" },
					value: { kind: "literal", value: "active" },
					operator: "eq",
					chain: "or",
				},
			]),
		),
	).toEqual([{ lhs: "status", rhs: "active", operator: "eq", chain: "or" }]);
});

test("if conditions save exactly the schema accepted by the server", () => {
	expect(
		serializeIfConditions([
			{
				lhs: { kind: "column", value: "input.status" },
				rhs: { kind: "literal", value: 200 },
				operator: "eq",
				chain: "and",
			},
		]),
	).toEqual([{ lhs: "input.status", rhs: 200, operator: "eq", chain: "and" }]);
});
