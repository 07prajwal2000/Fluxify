import type { SystemLog } from "@/services/systemLogs";
import type { BlockDiagnostic } from "./types";

export const COMPILE_SOURCE = "compile";

/**
 * Turns the latest compile log into diagnostics. The compiler reports plain
 * strings, so a block is found by its id (or, for "No codegen for block type",
 * its type) appearing in the message; anything else is canvas-wide. A clean or
 * inactive compile is still shown, as a canvas-wide note.
 */
export function compileDiagnostics(
	log: SystemLog | undefined,
	blocks: { id: string; type: string }[],
): BlockDiagnostic[] {
	const status = log?.detail?.status;
	if (!log) return [];
	if (status === "compiled" || status === "inactive") {
		const at = new Date(log.updatedAt).toLocaleString();
		return [{ severity: "info", message: `${log.message} · ${at}`, source: COMPILE_SOURCE }];
	}

	const message = `Compile failed: ${log.message}`;
	const type = /block type: (\S+)/.exec(log.message)?.[1];
	const culprits = blocks.filter((block) => log.message.includes(block.id) || block.type === type);
	if (culprits.length === 0) return [{ severity: "error", message, source: COMPILE_SOURCE }];
	return culprits.map((block) => ({
		blockId: block.id,
		severity: "error",
		message,
		source: COMPILE_SOURCE,
	}));
}
