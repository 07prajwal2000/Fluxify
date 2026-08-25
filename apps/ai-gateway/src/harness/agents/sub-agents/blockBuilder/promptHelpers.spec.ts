import { describe, expect, it } from "bun:test";
import {
	BUILTIN_BLOCK_SCHEMAS_REFERENCE,
	createSystemPrompt,
} from "./promptHelpers";

describe("Block Builder built-in schema reference", () => {
	it("preloads required data fields for built-in blocks", () => {
		expect(BUILTIN_BLOCK_SCHEMAS_REFERENCE).toContain("### jsrunner");
		expect(BUILTIN_BLOCK_SCHEMAS_REFERENCE).toContain('"value"');
		expect(BUILTIN_BLOCK_SCHEMAS_REFERENCE).toContain("### getvar");
		expect(BUILTIN_BLOCK_SCHEMAS_REFERENCE).toContain('"key"');
		expect(BUILTIN_BLOCK_SCHEMAS_REFERENCE).toContain("### response");
		expect(BUILTIN_BLOCK_SCHEMAS_REFERENCE).toContain('"httpCode"');
	});

	it("tells the agent that built-in contracts are already available", () => {
		const prompt = createSystemPrompt("No custom blocks.", "Platform docs.");

		expect(prompt).toContain("#### Built-in Block Data Contracts");
		expect(prompt).toContain("never fetch them");
		expect(prompt).toContain("get_custom_block_schemas");
	});
});
