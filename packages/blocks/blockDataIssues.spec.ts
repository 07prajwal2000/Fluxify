import { describe, expect, it } from "bun:test";
import { blockDataIssues } from "./blockDataIssues";
import { BlockTypes } from "./blockTypes";
import { block, createContext, edge } from "./builtin/tests/compilerTestHelpers";
import { compileGraph } from "./compiler";
import { CODE_JS_PREFIX_MESSAGE, literalExpressionIssues } from "./literalExpressions";

const messages = (type: string, data: unknown) =>
	blockDataIssues([{ id: "b", type, data }]).map((issue) => issue.message);

const condition = (operator: string) => ({
	attribute: { kind: "column", value: "id" },
	operator,
	value: { kind: "literal", value: 1 },
	chain: "and",
});

describe("blockDataIssues (#673)", () => {
	it("names the block and the field, and lists an enum's values", () => {
		const data = {
			blockName: "Delete user",
			connection: "c",
			tableName: "users",
			conditions: [condition("equals")],
		};
		const [message] = messages(BlockTypes.db_delete, data);
		expect(message).toStartWith('db_delete "Delete user": conditions[0].operator must be one of eq, neq,');
		expect(message).toContain("not_exists");
	});

	it("says required and wrong type plainly", () => {
		expect(messages(BlockTypes.db_delete, { tableName: 5, conditions: [] })).toEqual([
			"db_delete: connection is required",
			"db_delete: tableName must be a string",
		]);
	});

	it("picks the union member the data was meant to be", () => {
		const bare = { connection: "c", tableName: "t", conditions: [{ attribute: "id", operator: "eq", value: 1, chain: "and" }] };
		expect(messages(BlockTypes.db_delete, bare)).toEqual([
			"db_delete: conditions[0].attribute must be an object",
			"db_delete: conditions[0].value must be an object",
		]);
	});

	it("is quiet for good data and custom blocks", () => {
		expect(messages(BlockTypes.db_delete, { connection: "c", tableName: "t", conditions: [condition("eq")] })).toEqual([]);
		expect(messages("weather_lookup", { anything: 1 })).toEqual([]);
	});
});

describe("js: in a code field", () => {
	it("warns", () => {
		const issues = literalExpressionIssues([{ id: "b", type: BlockTypes.jsrunner, data: { value: " js: const x = 1; return x;" } }]);
		expect(issues).toEqual([{ blockId: "b", severity: "warning", message: CODE_JS_PREFIX_MESSAGE }]);
		expect(literalExpressionIssues([{ id: "b", type: BlockTypes.jsrunner, data: { value: "return 1" } }])).toEqual([]);
	});

	it("is dropped by the compiler, so the code runs", async () => {
		const { run, source } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.jsrunner, { value: "js: const x = 1; return x;" }),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")],
		);
		expect(source).not.toContain("js: const");
		expect(await run(createContext(), {})).toMatchObject({ output: { body: 1 } });
	});
});
