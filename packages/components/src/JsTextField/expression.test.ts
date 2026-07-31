import { describe, expect, it } from "bun:test";
import {
	isJsExpression,
	readExpression,
	writeExpression,
} from "./expression";

describe("expression", () => {
	it("treats only the js: prefix as an expression", () => {
		expect(isJsExpression("js:input.id")).toBe(true);
		expect(isJsExpression("js:")).toBe(true);
		expect(isJsExpression("hello")).toBe(false);
		expect(isJsExpression("")).toBe(false);
		expect(isJsExpression(undefined)).toBe(false);
	});

	it("reads the code back without the prefix", () => {
		expect(readExpression("js:input.id")).toBe("input.id");
		// A literal has no code — not "hello".
		expect(readExpression("hello")).toBe("");
		expect(readExpression(undefined)).toBe("");
	});

	it("round-trips code that itself looks like a literal", () => {
		const code = "js: this is not stripped twice";
		expect(readExpression(writeExpression(code))).toBe(code);
	});
});
