import { describe, expect, it } from "bun:test";
import { validateGraphRules } from "./graphRules";

const block = (
	id: string,
	blockType: string,
	connections: Array<{ blockId: string; handle?: string }> = [],
) => ({ id, blockType, connections });

describe("validateGraphRules", () => {
	it("rejects two edges hanging off one handle", () => {
		const errors = validateGraphRules([
			block("a", "entrypoint", [{ blockId: "b" }, { blockId: "c" }]),
		]);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("fans out");
	});

	it("allows an if block's two branch handles", () => {
		expect(
			validateGraphRules([
				block("a", "if", [
					{ blockId: "b", handle: "success" },
					{ blockId: "c", handle: "failure" },
				]),
			]),
		).toEqual([]);
	});

	it("allows a loop's source and executor", () => {
		expect(
			validateGraphRules([
				block("a", "forloop", [
					{ blockId: "b", handle: "source" },
					{ blockId: "c", handle: "executor" },
				]),
			]),
		).toEqual([]);
	});

	it("rejects a handle the block type does not have", () => {
		const errors = validateGraphRules([
			block("a", "httprequest", [{ blockId: "b", handle: "success" }]),
		]);
		expect(errors[0]).toContain('has no "success" handle');
	});

	it("rejects an outgoing edge on a terminal block", () => {
		const errors = validateGraphRules([
			block("a", "response", [{ blockId: "b" }]),
		]);
		expect(errors[0]).toContain("terminal block");
	});

	it("rejects duplicate entrypoints and duplicate block ids", () => {
		const errors = validateGraphRules([
			block("a", "entrypoint"),
			block("b", "entrypoint"),
			block("b", "setvar"),
		]);
		expect(errors.some((e) => e.includes("defined more than once"))).toBe(true);
		expect(errors.some((e) => e.includes('exactly one "entrypoint"'))).toBe(true);
	});

	// The compiler has no codegen for an error handler reached as an ordinary
	// block, so one invented edge stops the whole route compiling. Rejecting it
	// here gives the model a correction; the apply path drops what slips past.
	it("rejects a connection into a block with no inbound socket", () => {
		const errors = validateGraphRules([
			block("a", "consolelog", [{ blockId: "h" }]),
			block("h", "error_handler"),
		]);
		expect(errors[0]).toContain("Nothing may connect into it");
	});

	it("still allows the error handler's own recovery flow", () => {
		expect(
			validateGraphRules([
				block("h", "error_handler", [{ blockId: "a" }]),
				block("a", "consolelog"),
			]),
		).toEqual([]);
	});

	it("treats custom blocks as a single source handle", () => {
		expect(
			validateGraphRules([block("a", "custom:send_email", [{ blockId: "b" }])]),
		).toEqual([]);
		expect(
			validateGraphRules([
				block("a", "custom:send_email", [
					{ blockId: "b", handle: "executor" },
				]),
			])[0],
		).toContain('has no "executor" handle');
	});
});
