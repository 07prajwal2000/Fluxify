import { uuidv7 } from "../ids";
import type { BlockEdge, BlockNode } from "../types";

/** A detached slice of the graph: what a copy holds and a paste inserts. */
export type GraphPart = { nodes: BlockNode[]; edges: BlockEdge[] };

export type CloneOptions = {
	/** Shifts the clones so they don't land exactly on the originals. */
	offset?: { x: number; y: number };
	/** Selects the clones (and lets the caller deselect the originals). */
	select?: boolean;
};

export const EMPTY_PART: GraphPart = { nodes: [], edges: [] };

/**
 * Handles are named after their block (`<blockId>-<kind>`), so a clone's handles
 * have to be renamed too or its edges would point at the original's sockets.
 */
function remapHandle(
	handle: string | null | undefined,
	oldBlockId: string,
	newBlockId: string,
): string | null {
	if (!handle) return null;
	const prefix = `${oldBlockId}-`;
	if (!handle.startsWith(prefix)) return handle;
	return `${newBlockId}-${handle.slice(prefix.length)}`;
}

/** Deep enough copy for block data: it is always JSON-shaped. */
function cloneData(data: BlockNode["data"]): BlockNode["data"] {
	return structuredClone(data);
}

/**
 * Copies a slice of the graph with fresh ids, keeping the connections between the
 * copied blocks intact. Edges pointing outside the slice are dropped — they would
 * otherwise silently attach the clone to the original's neighbours.
 *
 * Used by both duplicate and paste, so the two can never drift apart.
 */
export function cloneGraphPart(part: GraphPart, options: CloneOptions = {}): GraphPart {
	const { offset = { x: 0, y: 0 }, select = false } = options;
	const idMap = new Map(part.nodes.map((node) => [node.id, uuidv7()]));

	const nodes = part.nodes.map<BlockNode>((node) => ({
		...node,
		id: idMap.get(node.id) as string,
		position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
		data: cloneData(node.data),
		selected: select,
		dragging: false,
	}));

	const edges: BlockEdge[] = [];
	for (const edge of part.edges) {
		const source = idMap.get(edge.source);
		const target = idMap.get(edge.target);
		if (!source || !target) continue;
		edges.push({
			...edge,
			id: uuidv7(),
			source,
			target,
			sourceHandle: remapHandle(edge.sourceHandle, edge.source, source),
			targetHandle: remapHandle(edge.targetHandle, edge.target, target),
			selected: select,
		});
	}

	return { nodes, edges };
}

/**
 * The part of the graph a copy should take: the given blocks (defaulting to the
 * selection) plus every edge running between them.
 */
export function pickGraphPart(
	nodes: BlockNode[],
	edges: BlockEdge[],
	blockIds?: Iterable<string>,
): GraphPart {
	const wanted = blockIds
		? new Set(blockIds)
		: new Set(nodes.filter((node) => node.selected).map((node) => node.id));
	if (wanted.size === 0) return EMPTY_PART;

	return {
		nodes: nodes.filter((node) => wanted.has(node.id)),
		edges: edges.filter((edge) => wanted.has(edge.source) && wanted.has(edge.target)),
	};
}
