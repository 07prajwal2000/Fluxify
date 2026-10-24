import { describe, expect, it } from "bun:test";
import { extractReturnType, wrapScript } from "./inferScriptOutput";

describe("wrapScript", () => {
	it("makes the script an async function body with a typed input", () => {
		const wrapped = wrapScript("return input.id;", "{ id: number }");

		expect(wrapped).toContain("@param {{ id: number }} input");
		expect(wrapped).toContain("async function __fluxifyRun(input) {\nreturn input.id;\n}");
	});

	it("puts a multi-line input type on one line", () => {
		expect(wrapScript("", "{\n  id: number;\n}")).toContain("@param {{ id: number; }} input");
	});
});

describe("extractReturnType", () => {
	it("reads the type out of the awaited return", () => {
		const dts = "/** @param {any} input */\ndeclare function __fluxifyRun(input: any): Promise<{\n    id: number;\n}>;\n";

		expect(extractReturnType(dts)).toBe("{\n    id: number;\n}");
	});

	it("treats a script with no return as undefined", () => {
		expect(extractReturnType("declare function __fluxifyRun(input: any): Promise<void>;")).toBe(
			"undefined",
		);
	});

	it("falls back to any when nothing was emitted", () => {
		expect(extractReturnType("")).toBe("any");
		expect(extractReturnType("declare const nope: 1;")).toBe("any");
	});
});
