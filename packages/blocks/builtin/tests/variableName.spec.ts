import { describe, expect, it } from "bun:test";
import { variableNameError } from "../../variableName";

describe("variableNameError", () => {
	it("accepts identifiers, reserved words included (read as outputs.<name>)", () => {
		for (const name of ["users", "_tmp", "$res", "newUser", "a1", "class", "return"]) {
			expect(variableNameError(name)).toBeUndefined();
		}
	});

	it("rejects empty names and bad characters", () => {
		expect(variableNameError("")).toBe("Variable name is required");
		expect(variableNameError("1abc")).toContain("must start with a letter");
		expect(variableNameError("a-b")).toContain("must start with a letter");
	});
});
