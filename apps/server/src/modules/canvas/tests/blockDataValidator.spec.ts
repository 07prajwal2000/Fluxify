import { describe, expect, it } from "bun:test";
import { BlockTypes } from "@fluxify/blocks";
import { blockDataValidator } from "../blockDataValidator";
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
