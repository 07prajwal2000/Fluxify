import type { CanvasBlock, CanvasEdge, CanvasGraph } from "../types";
import type { ChangeAction, ChangeSet } from "./changeTracker";

/**
 * What the save endpoint expects: the action per id, plus the full record for
 * everything being upserted. Deleted ids carry no payload.
 */
export type CanvasSavePayload = {
	actionsToPerform: {
		blocks: { id: string; action: ChangeAction }[];
		edges: { id: string; action: ChangeAction }[];
	};
	changes: {
		blocks: CanvasBlock[];
		edges: CanvasEdge[];
	};
};

/** Turns the tracked delta into the request body. O(changes), not O(graph). */
export function buildSavePayload(
	graph: CanvasGraph,
	changes: ChangeSet,
): CanvasSavePayload {
	const blocksById = new Map(graph.blocks.map((block) => [block.id, block]));
	const edgesById = new Map(graph.edges.map((edge) => [edge.id, edge]));

	const payload: CanvasSavePayload = {
		actionsToPerform: { blocks: [], edges: [] },
		changes: { blocks: [], edges: [] },
	};

	for (const [id, action] of changes.blocks) {
		const block = blocksById.get(id);
		// Tracked as an upsert but gone from the graph: skip rather than send a
		// half-formed record.
		if (action === "upsert" && !block) continue;
		payload.actionsToPerform.blocks.push({ id, action });
		if (action === "upsert" && block) payload.changes.blocks.push(block);
	}

	for (const [id, action] of changes.edges) {
		const edge = edgesById.get(id);
		if (action === "upsert" && !edge) continue;
		payload.actionsToPerform.edges.push({ id, action });
		if (action === "upsert" && edge) payload.changes.edges.push(edge);
	}

	return payload;
}
