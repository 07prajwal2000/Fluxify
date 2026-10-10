import { layoutGraph } from "@fluxify/blocks/layout";
import type { CanvasGraph } from "@/components/canvas/types";
import type { CanvasDiff } from "./canvasDiff";

/** Positions from the canvas when every block has one, else laid out (a diff built from ops alone has none). */
function positions(diff: CanvasDiff) {
	if (diff.blocks.every((b) => b.position)) return undefined;
	const keys = new Set(diff.blocks.map((b) => b.key));
	return layoutGraph(
		diff.blocks.map((b) => ({ id: b.key, type: b.type })),
		diff.edges.filter((e) => keys.has(e.from) && keys.has(e.to)),
	);
}

/**
 * The handle an edge leaves from. An op that names none ("source", the default)
 * is left to the canvas, which takes the block's first output; one that names it
 * (`failure`) must keep it, or every edge would leave from `success`.
 */
const handleOf = (block: string, handle: string, partial?: boolean) =>
	partial && handle === "source" ? "" : `${block}-${handle}`;

/** Blocks are named by key here; handle ids are `<block>-<handle>`, as the canvas stores them. */
export function toGraph(diff: CanvasDiff): CanvasGraph {
	const laid = positions(diff);
	const keys = new Set(diff.blocks.map((b) => b.key));
	return {
		blocks: diff.blocks.map((b) => ({
			id: b.key,
			key: b.key,
			type: b.type,
			data: b.data,
			position: laid?.[b.key] ?? b.position ?? { x: 0, y: 0 },
		})),
		edges: diff.edges
			.filter((e) => keys.has(e.from) && keys.has(e.to))
			.map((e) => ({
				id: e.id,
				from: e.from,
				to: e.to,
				fromHandle: handleOf(e.from, e.handle, diff.partial),
				// ops alone do not know a block's real handles: the canvas picks its first input
				toHandle: diff.partial ? "" : `${e.to}-target`,
			})),
	};
}
