import { formatFieldError, parseApiError } from "@/lib/errorNotifier";
import type { CanvasGraph } from "../types";
import type { BlockDiagnostic } from "./types";

export const SAVE_SOURCE = "save";
export const SAVE_CHECK_SOURCE = "save-check";

type SaveIssue = { severity?: string; message?: string; blockId?: string };

/**
 * The warnings a successful save came back with (#673: block data that does not
 * match its schema, among others), pinned to their blocks. One the editor
 * already shows from its own checks is left out, so nothing appears twice.
 */
export function blockDiagnosticsFromSaveResult(
	result: unknown,
	graph: CanvasGraph,
	shown: BlockDiagnostic[],
): BlockDiagnostic[] {
	const issues = (result as { issues?: SaveIssue[] } | null)?.issues;
	if (!Array.isArray(issues)) return [];
	const blockIds = new Set(graph.blocks.map((b) => b.id));
	const seen = new Set(
		shown.map(
			(d) => `${d.blockId}
${d.message}`,
		),
	);
	return issues
		.filter(
			(i) =>
				typeof i.message === "string" &&
				!seen.has(`${i.blockId}
${i.message}`),
		)
		.map((i) => ({
			...(i.blockId && blockIds.has(i.blockId) ? { blockId: i.blockId } : {}),
			severity: i.severity === "error" ? "error" : "warning",
			message: i.message as string,
			source: SAVE_CHECK_SOURCE,
		}));
}

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
