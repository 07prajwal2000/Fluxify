import { describe, expect, it } from "bun:test";
import { blockAiDescriptions } from "./blockAiDescriptions";
import {
	COMPACT_BLOCK_SCHEMAS_REFERENCE,
	COMPACT_SHARED_TYPES,
	renderCompactSchema,
} from "./compactSchemas";

describe("compact block schemas", () => {
	/**
	 * The gate. This reference is derived from the zod schemas, so editing a
	 * block's params rewrites it — and this snapshot fails until someone has
	 * read the diff and re-blessed it (`bun test -u`). A contract that drifts
	 * away from what the block validates is the failure this exists to catch.
	 */
	it("renders a stable reference", () => {
		expect(COMPACT_BLOCK_SCHEMAS_REFERENCE).toMatchSnapshot();
	});

	it("covers every block that has a schema", () => {
		for (const block of blockAiDescriptions) {
			if (!block.jsonSchema) continue;
			expect(COMPACT_BLOCK_SCHEMAS_REFERENCE).toContain(`\n${block.name} {`);
		}
	});

	it("states shared condition types once and references them by name", () => {
		expect(COMPACT_SHARED_TYPES).toContain("type DbWhereCondition = {");
		// The whole point of hoisting: the four condition-capable DB blocks
		// name the type instead of each re-inlining its four fields.
		expect(renderCompactSchema(JSON.stringify({
			type: "object",
			properties: { conditions: { type: "array", items: { type: "string" } } },
			required: ["conditions"],
		}))).toContain("conditions: string[];");
		const inlined = COMPACT_BLOCK_SCHEMAS_REFERENCE.split("db_getall")[1] ?? "";
		expect(inlined).toContain("conditions: DbWhereCondition[];");
	});

	it("drops the fields every block inherits", () => {
		expect(COMPACT_BLOCK_SCHEMAS_REFERENCE).not.toContain("blockName");
		expect(COMPACT_BLOCK_SCHEMAS_REFERENCE).not.toContain("blockDescription");
	});

	it("never renders a placeholder in place of a type", () => {
		expect(COMPACT_BLOCK_SCHEMAS_REFERENCE).not.toContain("[object Object]");
		expect(COMPACT_BLOCK_SCHEMAS_REFERENCE).not.toContain(": undefined");
	});

	it("costs a fraction of the JSON Schema it replaces", () => {
		const jsonSchemaChars = blockAiDescriptions.reduce(
			(total, block) => total + (block.jsonSchema?.length ?? 0),
			0,
		);
		expect(COMPACT_BLOCK_SCHEMAS_REFERENCE.length).toBeLessThan(
			jsonSchemaChars / 2,
		);
	});
});
