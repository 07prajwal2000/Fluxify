import { describe, expect, it } from "bun:test";
import {
	BUILTIN_BLOCK_SCHEMAS_REFERENCE,
	createSystemPrompt,
} from "./promptHelpers";

describe("Block Builder built-in schema reference", () => {
	it("preloads required data fields for built-in blocks", () => {
		expect(BUILTIN_BLOCK_SCHEMAS_REFERENCE).toContain("jsrunner {");
		expect(BUILTIN_BLOCK_SCHEMAS_REFERENCE).toContain("value: string;");
		expect(BUILTIN_BLOCK_SCHEMAS_REFERENCE).toContain("getvar {");
		expect(BUILTIN_BLOCK_SCHEMAS_REFERENCE).toContain("key: string;");
		expect(BUILTIN_BLOCK_SCHEMAS_REFERENCE).toContain("response {");
		expect(BUILTIN_BLOCK_SCHEMAS_REFERENCE).toContain("httpCode: string;");
	});

	it("teaches the notation it renders the contracts in", () => {
		const prompt = createSystemPrompt("No custom blocks.", "Platform docs.");

		// Without the legend the model has to guess what `?` and `|` mean, and
		// a shared `type` name looks like a block it cannot find in the table.
		expect(prompt).toContain("The notation is TypeScript");
		expect(prompt).toContain("type DbWhereCondition = {");
		expect(prompt).toContain("conditions: DbWhereCondition[];");
	});

	it("tells the agent that built-in contracts are already available", () => {
		const prompt = createSystemPrompt("No custom blocks.", "Platform docs.");

		expect(prompt).toContain("#### Built-in Block Data Contracts");
		expect(prompt).toContain("never fetch them");
		expect(prompt).toContain("get_custom_block_schemas");
	});
});
