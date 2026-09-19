import { isAxiosError } from "axios";
import type { CanvasGraph } from "../types";
import type { BlockDiagnostic } from "./types";

export const SAVE_SOURCE = "save";

/**
 * Turns a failed save's per-block validation errors (server sends `field` as
 * the block id, see `blockDataValidator.ts`) into diagnostics, so the toast
 * can stay generic instead of putting a raw block id in front of the user.
 * Returns null for anything that isn't this specific error shape (network
 * error, 500, unrelated 400), so the caller falls back to the generic notifier.
 */
export function blockDiagnosticsFromSaveError(
	error: unknown,
	graph: CanvasGraph,
): BlockDiagnostic[] | null {
	if (!isAxiosError(error) || error.response?.status !== 400) return null;
	const data = error.response.data as {
		type?: string;
		errors?: { field: string; message: string }[];
	};
	if (data?.type !== "validation" || !data.errors?.length) return null;

	const blockIds = new Set(graph.blocks.map((b) => b.id));
	return data.errors.map((err) => ({
		blockId: blockIds.has(err.field) ? err.field : undefined,
		severity: "error",
		message: err.message,
		source: SAVE_SOURCE,
	}));
}
