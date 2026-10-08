import { describe, expect, it } from "bun:test";
import { LITERAL_EXPRESSION_SOURCE, validateLiteralExpressions } from "./literalExpressionValidator";

const graph = (type: string, data: Record<string, unknown>) =>
	({ blocks: [{ id: "b", type, data, position: { x: 0, y: 0 } }], edges: [] }) as never;

describe("validateLiteralExpressions", () => {
	it("warns on a block with a bare expression", () => {
		expect(validateLiteralExpressions(graph("setvar", { key: "k", value: "input.id" }))).toMatchObject([
			{ blockId: "b", severity: "warning", source: LITERAL_EXPRESSION_SOURCE },
		]);
	});

	it("is quiet for js: and code fields", () => {
		expect(validateLiteralExpressions(graph("setvar", { key: "k", value: "js: return input.id" }))).toEqual([]);
		expect(validateLiteralExpressions(graph("jsrunner", { value: "input.id" }))).toEqual([]);
	});
});
