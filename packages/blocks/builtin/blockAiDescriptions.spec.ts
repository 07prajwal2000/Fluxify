import { describe, expect, it } from "bun:test";
import { BlockTypes } from "../blockTypes";
import { blockAiDescriptions } from "./blockAiDescriptions";
import { builtinBlockSchemas } from "./blockSchemasMap";

/**
 * The name an AI description carries IS the block type the agent writes into a
 * canvas, and storage only accepts `BlockTypes` values. When the two drifted
 * apart (`get_http_header` vs `httpgetheader`) every AI-built route using those
 * blocks persisted an unknown type — silently, because nothing validated it.
 */
describe("blockAiDescriptions", () => {
	const storedTypes = new Set<string>(Object.values(BlockTypes));

	it("names every block by its stored block type", () => {
		for (const description of blockAiDescriptions) {
			expect({ name: description.name, valid: storedTypes.has(description.name) }).toEqual({
				name: description.name,
				valid: true,
			});
		}
	});

	it("offers every block the agent is told to build", () => {
		const offered = new Set(blockAiDescriptions.map((d) => d.name as string));
		// the block builder prompt requires exactly one of each on a new canvas
		expect(offered.has(BlockTypes.entrypoint)).toBe(true);
		expect(offered.has(BlockTypes.errorHandler)).toBe(true);
	});

	it("keys every data schema by a stored block type", () => {
		const keys = new Set(Object.values(BlockTypes).map((t) => t.replace(/_/g, "").toLowerCase()));
		for (const key of Object.keys(builtinBlockSchemas)) {
			expect({ key, valid: keys.has(key) }).toEqual({ key, valid: true });
		}
	});
});
