import { describe, expect, it } from "bun:test";
import type { CustomBlockUsage } from "../../../db/schema";
import { canvasRuleIssues, type RulesInput } from "../rules";

const usageOf = new Map<string, CustomBlockUsage>([
	["seed", "test"],
	["auth_mw", "middleware"],
	["charge", "flow"],
]);

const check = (kind: RulesInput["kind"], type: string, data: unknown = {}, selfUsage?: CustomBlockUsage) =>
	canvasRuleIssues({ kind, selfUsage, usageOf, blocks: [{ id: "b", type, data }] });

describe("canvas rules", () => {
	it("refuses a test-only block outside a test block's canvas", () => {
		expect(check("route", "seed")[0]).toMatchObject({ severity: "error", blockId: "b" });
		expect(check("custom_block", "seed", {}, "flow")).toHaveLength(1);
		expect(check("custom_block", "seed", {}, "test")).toEqual([]);
	});

	it("refuses a middleware block on every canvas", () => {
		for (const kind of ["route", "workflow", "custom_block"] as const) {
			expect(check(kind, "auth_mw")[0]?.severity).toBe("error");
		}
	});

	it("allows a flow custom block anywhere", () => {
		expect(check("route", "charge")).toEqual([]);
		expect(check("workflow", "charge")).toEqual([]);
	});

	it("warns about a Response block only in a workflow", () => {
		expect(check("workflow", "response")[0]).toMatchObject({ severity: "warning" });
		expect(check("route", "response")).toEqual([]);
		expect(check("custom_block", "response", {}, "flow")).toEqual([]);
	});

	it("warns about HTTP blocks and request JS in a workflow", () => {
		expect(check("workflow", "httpgetheader")).toHaveLength(1);
		const js = { value: "const b = getRequestBody(); return b;" };
		expect(check("workflow", "jsrunner", js)[0]?.message).toContain("getRequestBody");
		expect(check("route", "jsrunner", js)).toEqual([]);
		// inline js: values nested anywhere in the data count too
		expect(check("workflow", "transformer", { fieldMap: { a: "js:getHeader('x')" } })).toHaveLength(1);
	});

	it("warns about response JS outside a middleware", () => {
		const js = { value: "return getResponseStatus();" };
		expect(check("route", "jsrunner", js)[0]?.message).toContain("after middleware");
		expect(check("custom_block", "jsrunner", js, "middleware")).toEqual([]);
	});


	it("warns when a text field looks like an expression without js:", () => {
		const warning = (data: unknown, type = "setvar") =>
			check("route", type, data).map((i) => i.severity);
		expect(warning({ key: "k", value: "{{input.id}}" })).toEqual(["warning"]);
		expect(warning({ key: "k", value: "input.id" })).toEqual(["warning"]);
		expect(warning({ key: "k", value: "js: return input.id" })).toEqual([]);
		expect(warning({ key: "k", value: "plain text" })).toEqual([]);
		expect(warning({ value: "input.map((x) => x)" }, "jsrunner")).toEqual([]);
	});
	it("is quiet for a plain canvas", () => {
		expect(check("workflow", "jsrunner", { value: "return trigger.data;" })).toEqual([]);
	});
});
