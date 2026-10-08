import { describe, expect, it } from "bun:test";
import {
	BARE_EXPRESSION_MESSAGE,
	literalExpressionIssues,
	TEMPLATE_MESSAGE,
} from "./literalExpressions";

const check = (type: string, data: unknown) => literalExpressionIssues([{ id: "b", type, data }]);
const warning = (message: string) => ({ blockId: "b", severity: "warning", message });

describe("literalExpressionIssues", () => {
	it("warns about a {{ }} template", () => {
		expect(check("consolelog", { message: "Hello {{input.name}}" })).toEqual([warning(TEMPLATE_MESSAGE)]);
	});

	it("warns about a bare expression, also nested", () => {
		for (const text of ["input.id", "vars.x", "cfg.KEY", "data.name", " input.id"]) {
			expect(check("setvar", { key: "k", value: text })).toEqual([warning(BARE_EXPRESSION_MESSAGE)]);
		}
		expect(check("httprequest", { headers: { a: ["input.token"] } })).toHaveLength(1);
	});

	it("is quiet for js: values and plain text", () => {
		expect(check("setvar", { key: "k", value: "js: return input.id" })).toEqual([]);
		expect(check("setvar", { key: "k", value: "js: return `{{`" })).toEqual([]);
		expect(check("consolelog", { message: "Order created" })).toEqual([]);
		expect(check("consolelog", { message: "the input.id is bad" })).toEqual([]);
		expect(check("setvar", { key: "k", value: 5 })).toEqual([]);
	});

	it("skips code, SQL and name fields", () => {
		expect(check("jsrunner", { value: "input.map((x) => x)" })).toEqual([]);
		expect(check("transformer", { useJs: true, js: "input.a", fieldMap: { a: "data.x" } })).toEqual([]);
		expect(check("response", { transformEnabled: true, transformScript: "input.rows" })).toEqual([]);
		expect(check("db_native", { js: "return dbQuery('select {{1}}')" })).toEqual([]);
		const raw = { conditions: [{ operator: "raw", raw: "id = {{ input.id }}" }] };
		expect(check("db_getall", { tableName: "data.users", ...raw })).toEqual([]);
		expect(check("sticky_note", { text: "use input.id" })).toEqual([]);
	});

	it("reports each kind once per block", () => {
		const data = { a: "{{x}}", b: "{{y}}", c: "input.a", d: "input.b" };
		expect(check("setvar", data).map((i) => i.message)).toEqual([TEMPLATE_MESSAGE, BARE_EXPRESSION_MESSAGE]);
	});
});
