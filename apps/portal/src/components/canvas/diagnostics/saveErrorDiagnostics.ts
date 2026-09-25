import { formatFieldError, parseApiError } from "@/lib/errorNotifier";
import type { CanvasGraph } from "../types";
import type { BlockDiagnostic } from "./types";

export const SAVE_SOURCE = "save";

/**
 * Turns a failed save into diagnostics. Per-block validation errors (server
 * sends `field` as the block id, see `blockDataValidator.ts`) pin to their
 * block; anything else (other fields, network, 500, proxy page) becomes one
 * canvas-wide entry, so every save failure is visible in the panel.
 */
export function blockDiagnosticsFromSaveError(
	error: unknown,
	graph: CanvasGraph,
): BlockDiagnostic[] {
	const { message, fieldErrors } = parseApiError(error);
	if (!fieldErrors) return [{ severity: "error", message, source: SAVE_SOURCE }];

	const blockIds = new Set(graph.blocks.map((b) => b.id));
	return fieldErrors.map((err) =>
		err.field && blockIds.has(err.field)
			? { blockId: err.field, severity: "error", message: err.message, source: SAVE_SOURCE }
			: { severity: "error", message: formatFieldError(err), source: SAVE_SOURCE },
	);
}
