import { describe, expect, it } from "bun:test";
import { BlockTypes } from "@fluxify/blocks";
import { blockDataValidator } from "../blockDataValidator";
import { customBlockNames } from "../../../loaders/customBlocksLoader";
import type { CanvasChanges } from "../types";

/**
 * A new block type is registered in several places, and this validator is the
 * one nobody remembers — a block missing here saves nowhere, with only
 * "Invalid block type" to go on. So assert the whole enum rather than the block
 * of the day.
 */
const changes = (type: string, data: Record<string, unknown> = {}): CanvasChanges =>
	({
		actionsToPerform: { blocks: [], edges: [] },
		changes: {
			blocks: [{ id: "b1", type, data, position: { x: 0, y: 0 } }],
			edges: [],
		},
	}) as unknown as CanvasChanges;

describe("every block type the engine knows", () => {
	for (const type of Object.values(BlockTypes)) {
		it(`has a schema for ${type}`, () => {
			// Empty data may be rejected as invalid; what must not happen is the
			// type itself going unrecognised.
			try {
				blockDataValidator(changes(type));
			} catch (error) {
				expect((error as Error).message).not.toBe("Invalid block type");
			}
		});
	}
});

describe("the trigger workflow block", () => {
	it("saves before a workflow has been picked", () => {
		const data = changes(BlockTypes.triggerWorkflow, { blockName: "Kick off" });
		expect(() => blockDataValidator(data)).not.toThrow();
		expect(data.changes.blocks[0]!.data).toMatchObject({
			workflowId: "",
			useInput: false,
			blockName: "Kick off",
		});
	});

	it("keeps the workflow and data it was given", () => {
		const data = changes(BlockTypes.triggerWorkflow, {
			workflowId: "wf-1",
			useInput: false,
			data: "js: return { id: input.id };",
		});
		blockDataValidator(data);
		expect(data.changes.blocks[0]!.data).toMatchObject({
			workflowId: "wf-1",
			data: "js: return { id: input.id };",
		});
	});
});

describe("save output to variable", () => {
	const transformer = (name: string, enabled = true) =>
		changes(BlockTypes.transformer, {
			blockName: "Shape User",
			fieldMap: {},
			saveAsVariable: { enabled, name },
		});
	const messages = (run: () => void) => {
		try {
			run();
		} catch (error) {
			return (error as { errors?: { message: string }[] }).errors?.map((e) => e.message);
		}
		return [];
	};

	it("rejects a reserved word, naming the block and the word", () => {
		expect(messages(() => blockDataValidator(transformer("class")))).toEqual([
			'Shape User: "class" is a reserved JavaScript word and cannot be used as a variable name',
		]);
	});

	it("rejects an invalid or empty name", () => {
		expect(messages(() => blockDataValidator(transformer("1abc")))[0]).toContain("must start with a letter");
		expect(messages(() => blockDataValidator(transformer("  ")))[0]).toContain("Variable name is required");
	});

	it("rejects it on a custom block too", () => {
		// a registered custom block skips schema validation, so this is its only check
		customBlockNames.add("weather_lookup");
		try {
			const data = changes("weather_lookup", { saveAsVariable: { enabled: true, name: "return" } });
			expect(messages(() => blockDataValidator(data))).toEqual([
				'weather_lookup: "return" is a reserved JavaScript word and cannot be used as a variable name',
			]);
		} finally {
			customBlockNames.delete("weather_lookup");
		}
	});

	it("accepts a valid name, a padded one, and any name while the toggle is off", () => {
		expect(() => blockDataValidator(transformer("users"))).not.toThrow();
		expect(() => blockDataValidator(transformer("  users  "))).not.toThrow();
		expect(() => blockDataValidator(transformer("class", false))).not.toThrow();
	});
});
