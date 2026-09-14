import { describe, expect, it } from "bun:test";
import { variableNameError } from "../../variableName";

describe("variableNameError", () => {
	it("accepts plain identifiers", () => {
		for (const name of ["users", "_tmp", "$res", "classes", "newUser", "a1"]) {
			expect(variableNameError(name)).toBeUndefined();
		}
	});

	it("rejects reserved words with a message naming the word", () => {
		for (const name of ["class", "return", "null", "let", "await", "undefined"]) {
			expect(variableNameError(name)).toBe(
				`"${name}" is a reserved JavaScript word and cannot be used as a variable name`,
			);
		}
	});

	it("rejects empty names and bad characters", () => {
		expect(variableNameError("")).toBe("Variable name is required");
		expect(variableNameError("1abc")).toContain("must start with a letter");
		expect(variableNameError("a-b")).toContain("must start with a letter");
	});
});
