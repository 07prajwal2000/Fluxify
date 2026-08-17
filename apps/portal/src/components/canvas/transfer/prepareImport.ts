import { graphToFlow } from "../adapters";
import { canAddBlock } from "../blocks/blockCatalog";
import type { BlockType } from "../blocks/blockTypes";
import { cloneGraphPart, type GraphPart } from "../clipboard/cloneGraphPart";
import type { BlockNode } from "../types";
import type { CanvasTransferDoc } from "./format";

export type PrepareImportOptions = {
	/** Shifts the inserted blocks so they don't land on the existing ones. */
	offset?: { x: number; y: number };
	select?: boolean;
};

export type PreparedImport = {
	part: GraphPart;
	/** Route-owned blocks in the payload that were re-used instead of inserted. */
	reusedBlocks: number;
	/** Route-owned blocks in the payload with no counterpart on this canvas. */
	skippedBlocks: number;
	/** Connections that could not be re-attached and were left out. */
	droppedEdges: number;
};

/**
 * Blocks the route owns rather than the canvas — the entrypoint and the error
 * handler. Exactly the set `canAddBlock` already refuses to create, so the two
 * rules can never drift apart.
 */
function isRouteOwned(type: string | undefined): boolean {
	return !!type && !canAddBlock(type as BlockType);
}

/**
 * Turns a decoded payload into something insertable into *this* canvas.
 *
 * The entrypoint and error handler are created by the route, not by us, so a
 * payload carrying them must not add a second pair. They are dropped, and every
 * connection that referenced them is re-pointed at the blocks this canvas
 * already has — which is what keeps an imported flow actually wired to its
 * entry and its error path instead of floating unconnected.
 *
 * A connection is dropped when either end has nowhere to go: the payload
 * mentions an error handler this canvas doesn't have, or both of its ends are
 * pre-existing blocks (re-connecting those would edit the current graph rather
 * than add to it).
 */
export function prepareImport(
	doc: CanvasTransferDoc,
	currentNodes: BlockNode[],
	options: PrepareImportOptions = {},
): PreparedImport {
	const { nodes, edges } = graphToFlow({ blocks: doc.blocks, edges: doc.edges });

	// First block of each route-owned type wins; a canvas only ever has one.
	const existingByType = new Map<string, string>();
	for (const node of currentNodes) {
		if (isRouteOwned(node.type) && !existingByType.has(node.type as string)) {
			existingByType.set(node.type as string, node.id);
		}
	}

	const reused = new Map<string, string>();
	const inserted: BlockNode[] = [];
	let skippedBlocks = 0;
	for (const node of nodes) {
		if (!isRouteOwned(node.type)) {
			inserted.push(node);
			continue;
		}
		const existingId = existingByType.get(node.type as string);
		if (existingId) reused.set(node.id, existingId);
		else skippedBlocks += 1;
	}

	const insertedIds = new Set(inserted.map((node) => node.id));
	const keptEdges = edges.filter(
		(edge) => insertedIds.has(edge.source) || insertedIds.has(edge.target),
	);

	const part = cloneGraphPart(
		{ nodes: inserted, edges: keptEdges },
		{ offset: options.offset, select: options.select, idMap: reused },
	);

	return {
		part,
		reusedBlocks: reused.size,
		skippedBlocks,
		// Everything cloneGraphPart could not resolve, plus what we filtered above.
		droppedEdges: edges.length - part.edges.length,
	};
}
