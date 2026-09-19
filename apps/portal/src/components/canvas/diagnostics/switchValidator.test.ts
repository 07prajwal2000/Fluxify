import { describe, expect, it } from "bun:test";
import type { CanvasBlock, CanvasEdge } from "../types";
import { NO_DEFAULT, SWITCH_SOURCE, validateSwitches } from "./switchValidator";
import { diagnosticSourceLabel } from "./types";

const sw = (data: Record<string, unknown> = {}, id = "sw"): CanvasBlock => ({
	id,
	type: "switch",
	data,
	position: { x: 0, y: 0 },
});
const other = (
	id: string,
	type = "jsrunner",
	data: Record<string, unknown> = {},
): CanvasBlock => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const caseEdge = (
	to: string,
	from = "sw",
	handle = `${from}-case`,
): CanvasEdge => ({
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

/** case warnings only; the no-default warning has its own tests */
const messages = (blocks: CanvasBlock[], edges: CanvasEdge[]) =>
	validateSwitches({ blocks, edges })
		.map((d) => d.message)
		.filter((m) => m !== NO_DEFAULT);

const NO_CASES = /has no cases connected.*Connect a block to the Cases handle/;
const noCondition = (n: number) =>
	new RegExp(`^Case ${n} \\(.+\\) has no condition, so it never runs\\.`);

describe("validateSwitches", () => {
	it("warns when a switch has no cases, even with its input connected", () => {
		const diagnostics = validateSwitches({
			blocks: [other("entry", "entrypoint"), sw()],
			edges: [input()],
		});
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			blockId: "sw",
			severity: "warning",
			source: SWITCH_SOURCE,
		});
		expect(diagnostics[0]!.message).toMatch(NO_CASES);
	});

	it("warns about a lone switch with nothing connected at all", () => {
		expect(messages([sw()], [])).toHaveLength(1);
	});

	it("says nothing when every case has a condition", () => {
		const blocks = [
			sw({ conditions: { a: "js: return true;", b: "js: return 1;" } }),
			other("a"),
			other("b"),
		];
		expect(messages(blocks, [caseEdge("a"), caseEdge("b")])).toEqual([]);
	});

	it("warns once per case with a missing, empty, blank or empty js: condition", () => {
		const blocks = [
			sw({
				conditions: { b: "", c: "   ", d: "js:  ", e: "js: return true;" },
			}),
			...["a", "b", "c", "d", "e"].map((id) => other(id)),
		];
		const result = messages(
			blocks,
			["a", "b", "c", "d", "e"].map((id) => caseEdge(id)),
		);
		expect(result).toHaveLength(4);
		result.forEach((message, i) => {
			expect(message).toMatch(noCondition(i + 1));
		});
	});

	it("does not ask the default case for a condition", () => {
		const blocks = [
			sw({ conditions: { a: "js: return true;" }, defaultCase: "b" }),
			other("a"),
			other("b"),
		];
		expect(
			validateSwitches({ blocks, edges: [caseEdge("a"), caseEdge("b")] }),
		).toEqual([]);
	});

	it("warns once when a switch with cases has no default, or its default is not connected", () => {
		const count = (data: Record<string, unknown>) =>
			validateSwitches({
				blocks: [sw(data), other("a")],
				edges: [caseEdge("a")],
			}).filter((d) => d.message === NO_DEFAULT).length;
		expect(count({})).toBe(1);
		expect(count({ defaultCase: "gone" })).toBe(1);
		expect(count({ defaultCase: "a" })).toBe(0);
		expect(NO_DEFAULT).toContain("returns the Switch's input");
	});

	it("does not add the no-default warning when there are no cases", () => {
		expect(
			validateSwitches({ blocks: [sw()], edges: [] }).map((d) => d.message),
		).not.toContain(NO_DEFAULT);
	});

	it("names the case's block and says how to fix it", () => {
		const blocks = [sw(), other("a", "jsrunner", { blockName: "Charge card" })];
		const [message] = messages(blocks, [caseEdge("a")]);
		expect(message).toContain("Case 1 (Charge card)");
		expect(message).toContain("In the Cases tab, turn on JS");
		expect(message).toContain('return input.status === "paid";');
	});

	it("falls back to the catalog name, then the id, for the case's block", () => {
		expect(messages([sw(), other("a")], [caseEdge("a")])[0]).toContain(
			"Case 1 (JS Runner)",
		);
		expect(messages([sw()], [caseEdge("ghost")])[0]).toContain(
			"Case 1 (ghost)",
		);
	});

	it("numbers cases in the order they are checked", () => {
		const blocks = [
			sw({ order: ["b", "a"], conditions: { b: "js: return true;" } }),
			other("a"),
			other("b"),
		];
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
		expect(result[0]).toMatch(
			/^Case 2 \(.+\) has no match value, so it never runs\. In the Cases tab, enter the value/,
		);
	});

	it("ignores match values when not switching on a value", () => {
		const blocks = [sw({ matches: { a: "paid" } }), other("a")];
		expect(messages(blocks, [caseEdge("a")])[0]).toMatch(noCondition(1));
	});

	it("warns about an empty value script in value mode and says where to fix it", () => {
		const blocks = [
			sw({ useValue: true, value: " ", matches: { a: "paid" } }),
			other("a"),
		];
		const result = messages(blocks, [caseEdge("a")]);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain("value script is empty");
		expect(result[0]).toContain("In the General tab");
	});

	it("does not complain about the value script outside value mode", () => {
		const blocks = [
			sw({ value: "", conditions: { a: "js: return true;" } }),
			other("a"),
		];
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
		const blocks = [
			sw({}, "one"),
			sw({ conditions: { a: "js: return true;" }, defaultCase: "a" }, "two"),
			other("a"),
		];
		const diagnostics = validateSwitches({
			blocks,
			edges: [caseEdge("a", "two")],
		});
		expect(diagnostics.map((d) => d.blockId)).toEqual(["one"]);
	});

	it("tolerates a switch whose data is missing or malformed", () => {
		const broken: CanvasBlock = {
			...sw(),
			data: { order: "nope", conditions: null } as never,
		};
		expect(messages([broken, other("a")], [caseEdge("a")])[0]).toMatch(
			noCondition(1),
		);
	});

	it("accepts js: code without a warning", () => {
		const blocks = [
			sw({ conditions: { a: " js: return input.ok; " } }),
			other("a"),
		];
		expect(messages(blocks, [caseEdge("a")])).toEqual([]);
	});

	it("accepts plain-text literals without a warning", () => {
		const blocks = [
			sw({ conditions: { a: "paid", b: "404", c: " FALSE " } }),
			other("a"),
			other("b"),
			other("c"),
		];
		expect(
			messages(blocks, [caseEdge("a"), caseEdge("b"), caseEdge("c")]),
		).toEqual([]);
	});

	it("does not judge plain-text match values in value mode", () => {
		const blocks = [
			sw({
				useValue: true,
				value: "return input;",
				matches: { a: "false", b: "paid" },
			}),
			other("a"),
			other("b"),
		];
		expect(messages(blocks, [caseEdge("a"), caseEdge("b")])).toEqual([]);
	});

	it("ignores every other block type", () => {
		expect(
			messages([other("a", "if"), other("b", "orchestrator")], []),
		).toEqual([]);
	});
});

describe("diagnosticSourceLabel", () => {
	it("describes the switch and loop checks in words instead of ids", () => {
		expect(diagnosticSourceLabel(SWITCH_SOURCE)).toBe(
			"Switch check: every case must be able to run",
		);
		expect(diagnosticSourceLabel("cycle-detection")).toContain("Loop check");
		expect(diagnosticSourceLabel("compile")).toBe("Canvas compilation");
	});

	it("shows an unknown source as-is", () => {
		expect(diagnosticSourceLabel("custom-lint")).toBe("custom-lint");
	});
});
