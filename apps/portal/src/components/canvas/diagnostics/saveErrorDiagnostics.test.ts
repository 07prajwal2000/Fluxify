import { describe, expect, it } from "bun:test";
import type { CanvasBlock, CanvasGraph } from "../types";
import { blockDiagnosticsFromSaveError, SAVE_SOURCE } from "./saveErrorDiagnostics";

const block = (id: string): CanvasBlock => ({ id, type: "jsrunner", data: {}, position: { x: 0, y: 0 } });
const graph = (...ids: string[]): CanvasGraph => ({ blocks: ids.map(block), edges: [] });

const axiosError = (status: number, data: unknown) => ({
	isAxiosError: true,
	response: { status, data },
});

it("maps a validation error's block-id field to a block diagnostic", () => {
	const error = axiosError(400, {
		type: "validation",
		errors: [{ field: "b1", message: "Invalid block data" }],
	});

	expect(blockDiagnosticsFromSaveError(error, graph("b1", "b2"))).toEqual([
		{ blockId: "b1", severity: "error", message: "Invalid block data", source: SAVE_SOURCE },
	]);
});

it("drops the raw field into a canvas-wide diagnostic when it isn't a known block id", () => {
	const error = axiosError(400, {
		type: "validation",
		errors: [{ field: "not-a-block", message: "Unexpected" }],
	});

	expect(blockDiagnosticsFromSaveError(error, graph("b1"))?.[0].blockId).toBeUndefined();
});

it("turns any other failure into one canvas-wide diagnostic", () => {
	expect(blockDiagnosticsFromSaveError(axiosError(500, { message: "boom" }), graph("b1"))).toEqual([
		{ severity: "error", message: "boom", source: SAVE_SOURCE },
	]);
	expect(blockDiagnosticsFromSaveError(new Error("network down"), graph("b1"))[0].message).toBe(
		"network down",
	);
});
