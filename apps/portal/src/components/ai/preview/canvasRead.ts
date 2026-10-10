import type { ToolPart } from "../agentMessages";
import type { CanvasDiff, DiffBlock, DiffEdge } from "./canvasDiff";
import { isRec, rec, str } from "./data";

/** `if_1.success → db_insert_1`; the handle is left out for a block with only one. */
const EDGE = /^(\S+?)(?:\.(\S+))? → (\S+)$/;

/**
 * What get_canvas returned as a canvas to draw, or null when it is not one a
 * canvas can show faithfully: `compact` has no block data, and `blocks` keeps
 * only some of the blocks.
 */
export function canvasFromRead(tool: ToolPart): CanvasDiff | null {
	const input = rec(tool.input);
	const out = rec(tool.output);
	const listed = Array.isArray(input.blocks) && input.blocks.length > 0;
	if (input.compact === true || listed) return null;
	if (!Array.isArray(out.blocks) || out.blocks.length === 0 || !Array.isArray(out.edges))
		return null;
	const blocks: DiffBlock[] = [];
	for (const raw of out.blocks) {
		if (!isRec(raw) || !str(raw.key) || !str(raw.type) || !isRec(raw.data)) return null;
		// the note was split off from the data: the settings panel reads it from there
		const note = str(raw.note);
		const data =
			note && !("blockDescription" in raw.data) && raw.type !== "sticky_note"
				? { ...raw.data, blockDescription: note }
				: raw.data;
		blocks.push({ key: str(raw.key), type: str(raw.type), status: "same", data, changes: [] });
	}
	const edges: DiffEdge[] = [];
	for (const raw of out.edges) {
		const m = typeof raw === "string" ? EDGE.exec(raw) : null;
		if (!m) return null;
		edges.push({
			id: `${m[1]}.${m[2] ?? "source"}>${m[3]}`,
			from: m[1],
			to: m[3],
			handle: m[2] ?? "source",
			status: "same",
		});
	}
	// the handles of an edge written without one are not known: the canvas picks the block's only output
	return { blocks, edges, partial: true };
}
