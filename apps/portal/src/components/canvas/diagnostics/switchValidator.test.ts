import { describe, expect, it } from "bun:test";
import type { CanvasBlock, CanvasEdge } from "../types";
import { SWITCH_SOURCE, validateSwitches } from "./switchValidator";
import { diagnosticSourceLabel } from "./types";

const sw = (data: Record<string, unknown> = {}, id = "sw"): CanvasBlock => ({
	id,
	type: "switch",
	data,
	position: { x: 0, y: 0 },
});
const other = (id: string, type = "jsrunner", data: Record<string, unknown> = {}): CanvasBlock => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const caseEdge = (to: string, from = "sw", handle = `${from}-case`): CanvasEdge => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: handle,
	toHandle: `${to}-target`,
});
const input = (to = "sw"): CanvasEdge => ({
	id: `e-entry-${to}`,
	from: "entry",
	to,
	fromHandle: "entry-source",
	toHandle: `${to}-target`,
});

const messages = (blocks: CanvasBlock[], edges: CanvasEdge[]) =>
	validateSwitches({ blocks, edges }).map((d) => d.message);

const NO_CASES = /has no cases connected.*Connect a block to the Cases handle/;
const noCondition = (n: number) => new RegExp(`^Case ${n} \\(.+\\) has no condition, so it never runs\\.`);

describe("validateSwitches", () => {
	it("warns when a switch has no cases, even with its input connected", () => {
		const diagnostics = validateSwitches({
			blocks: [other("entry", "entrypoint"), sw()],
			edges: [input()],
		});
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({ blockId: "sw", severity: "warning", source: SWITCH_SOURCE });
		expect(diagnostics[0]!.message).toMatch(NO_CASES);
	});

	it("warns about a lone switch with nothing connected at all", () => {
		expect(messages([sw()], [])).toHaveLength(1);
	});

	it("says nothing when every case has a condition", () => {
		const blocks = [sw({ conditions: { a: "js: return true;", b: "true" } }), other("a"), other("b")];
		expect(messages(blocks, [caseEdge("a"), caseEdge("b")])).toEqual([]);
	});

	it("warns once per case with a missing, empty, blank or empty js: condition", () => {
		const blocks = [
			sw({ conditions: { b: "", c: "   ", d: "js:  ", e: "js: return true;" } }),
			...["a", "b", "c", "d", "e"].map((id) => other(id)),
		];
		const result = messages(blocks, ["a", "b", "c", "d", "e"].map((id) => caseEdge(id)));
		expect(result).toHaveLength(4);
		result.forEach((message, i) => expect(message).toMatch(noCondition(i + 1)));
	});

	it("names the case's block and says how to fix it", () => {
		const blocks = [sw(), other("a", "jsrunner", { blockName: "Charge card" })];
		const [message] = messages(blocks, [caseEdge("a")]);
		expect(message).toContain("Case 1 (Charge card)");
		expect(message).toContain("In the Cases tab, add a condition");
		expect(message).toContain('return input.status === "paid";');
	});

	it("falls back to the catalog name, then the id, for the case's block", () => {
		expect(messages([sw(), other("a")], [caseEdge("a")])[0]).toContain("Case 1 (JS Runner)");
		expect(messages([sw()], [caseEdge("ghost")])[0]).toContain("Case 1 (ghost)");
	});

	it("numbers cases in the order they are checked", () => {
		const blocks = [sw({ order: ["b", "a"], conditions: { b: "js: return true;" } }), other("a"), other("b")];
		const result = messages(blocks, [caseEdge("a"), caseEdge("b")]);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatch(noCondition(2));
	});

	it("checks match values, not conditions, when switching on a value", () => {
		const blocks = [
			sw({
				useValue: true,
				value: "return input.status;",
				conditions: { a: "js: return true;", b: "js: return true;" },
				matches: { a: "paid" },
			}),
			other("a"),
			other("b"),
		];
		const result = messages(blocks, [caseEdge("a"), caseEdge("b")]);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatch(/^Case 2 \(.+\) has no match value, so it never runs\. In the Cases tab, enter the value/);
	});

	it("ignores match values when not switching on a value", () => {
		const blocks = [sw({ matches: { a: "paid" } }), other("a")];
		expect(messages(blocks, [caseEdge("a")])[0]).toMatch(noCondition(1));
	});

	it("warns about an empty value script in value mode and says where to fix it", () => {
		const blocks = [sw({ useValue: true, value: " ", matches: { a: "paid" } }), other("a")];
		const result = messages(blocks, [caseEdge("a")]);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain("value script is empty");
		expect(result[0]).toContain("In the General tab");
	});

	it("does not complain about the value script outside value mode", () => {
		const blocks = [sw({ value: "", conditions: { a: "js: return true;" } }), other("a")];
		expect(messages(blocks, [caseEdge("a")])).toEqual([]);
	});

	it("accepts a bare `case` handle as well as the persisted `<id>-case` form", () => {
		const blocks = [sw({ conditions: { a: "js: return true;" } }), other("a")];
		expect(messages(blocks, [caseEdge("a", "sw", "case")])).toEqual([]);
	});

	it("does not count other blocks' edges, or a switch's inbound edge, as cases", () => {
		const blocks = [other("entry", "entrypoint"), sw(), other("x"), other("y")];
		const result = messages(blocks, [input(), caseEdge("y", "x", "x-source")]);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatch(NO_CASES);
	});

	it("checks each switch on the canvas separately", () => {
		const blocks = [sw({}, "one"), sw({ conditions: { a: "js: return true;" } }, "two"), other("a")];
		const diagnostics = validateSwitches({ blocks, edges: [caseEdge("a", "two")] });
		expect(diagnostics.map((d) => d.blockId)).toEqual(["one"]);
	});

	it("tolerates a switch whose data is missing or malformed", () => {
		const broken: CanvasBlock = { ...sw(), data: { order: "nope", conditions: null } as never };
		expect(messages([broken, other("a")], [caseEdge("a")])[0]).toMatch(noCondition(1));
	});

	it("accepts plain true in any case, and js: code, without a warning", () => {
		const blocks = [sw({ conditions: { a: "True", b: " js: return input.ok; " } }), other("a"), other("b")];
		expect(messages(blocks, [caseEdge("a"), caseEdge("b")])).toEqual([]);
	});

	it("warns that a case set to plain false never runs", () => {
		const blocks = [sw({ conditions: { a: " FALSE " } }), other("a")];
		const result = messages(blocks, [caseEdge("a")]);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatch(/^Case 1 \(.+\) is set to false, so it never runs\./);
	});

	it("warns when plain text looks like code, because it always matches", () => {
		const blocks = [sw({ conditions: { a: 'return input.status === "paid";' } }), other("a")];
		const [message] = messages(blocks, [caseEdge("a")]);
		expect(message).toContain('plain text "return input.status === "paid";"');
		expect(message).toContain("turn on JS in the field");
	});

	it("shortens long plain text in the warning", () => {
		const blocks = [sw({ conditions: { a: "x".repeat(60) } }), other("a")];
		const [message] = messages(blocks, [caseEdge("a")]);
		expect(message).toContain(`"${"x".repeat(40)}…"`);
		expect(message).not.toContain("x".repeat(41));
	});

	it("does not judge plain-text match values in value mode", () => {
		const blocks = [sw({ useValue: true, value: "return input;", matches: { a: "false", b: "paid" } }), other("a"), other("b")];
		expect(messages(blocks, [caseEdge("a"), caseEdge("b")])).toEqual([]);
	});

	it("ignores every other block type", () => {
		expect(messages([other("a", "if"), other("b", "orchestrator")], [])).toEqual([]);
	});
});

describe("diagnosticSourceLabel", () => {
	it("describes the switch and loop checks in words instead of ids", () => {
		expect(diagnosticSourceLabel(SWITCH_SOURCE)).toBe("Switch check: every case must be able to run");
		expect(diagnosticSourceLabel("cycle-detection")).toContain("Loop check");
		expect(diagnosticSourceLabel("compile")).toBe("Canvas compilation");
	});

	it("shows an unknown source as-is", () => {
		expect(diagnosticSourceLabel("custom-lint")).toBe("custom-lint");
	});
});
