import { describe, expect, it } from "bun:test";
import type { CanvasBlock, CanvasGraph } from "../types";
import {
	blockDiagnosticsFromSaveError,
	blockDiagnosticsFromSaveResult,
	SAVE_CHECK_SOURCE,
	SAVE_SOURCE,
} from "./saveErrorDiagnostics";

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

describe("a successful save's issues (#673)", () => {
	const result = {
		canvasVersion: 2,
		issues: [
			{ severity: "warning", blockId: "b1", message: "db_delete: conditions[0].operator must be one of eq, neq" },
			{ severity: "warning", blockId: "b2", message: "already shown" },
		],
	};

	it("pins the server's warnings to their blocks, skipping ones already shown", () => {
		const shown = [{ blockId: "b2", severity: "warning" as const, message: "already shown", source: "literal-expression" }];
		expect(blockDiagnosticsFromSaveResult(result, graph("b1", "b2"), shown)).toEqual([
			{
				blockId: "b1",
				severity: "warning",
				message: "db_delete: conditions[0].operator must be one of eq, neq",
				source: SAVE_CHECK_SOURCE,
			},
		]);
	});

	it("is empty for a save with no issues", () => {
		expect(blockDiagnosticsFromSaveResult({ canvasVersion: 2, issues: [] }, graph("b1"), [])).toEqual([]);
		expect(blockDiagnosticsFromSaveResult(undefined, graph("b1"), [])).toEqual([]);
	});
});
