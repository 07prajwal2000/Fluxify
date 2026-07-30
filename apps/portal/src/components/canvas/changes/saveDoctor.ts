import type { CanvasGraph } from "../types";
import type { ChangeSet } from "./changeTracker";
import { buildSavePayload, type CanvasSavePayload } from "./savePayload";

export type RepairReport = {
	payload: CanvasSavePayload;
	/** Human readable list of what the doctor changed. Empty = nothing to fix. */
	notes: string[];
};

/**
 * The doctor: rebuilds the save payload against what the server actually has and
 * removes the parts that cannot succeed.
 *
 * A save fails for a small set of predictable reasons, all of them a mismatch
 * between the tracked delta and server state:
 * - deleting something the server never had (or already dropped),
 * - upserting a record that is no longer on the canvas,
 * - upserting an edge whose blocks exist on neither side (foreign key),
 * - deleting a block while the server still has edges pointing at it.
 *
 * Pure: it only reads the graphs and returns a new payload.
 */
export function repairSavePayload(
	graph: CanvasGraph,
	changes: ChangeSet,
	server: CanvasGraph,
): RepairReport {
	const notes: string[] = [];
	const localBlocks = new Map(graph.blocks.map((block) => [block.id, block]));
	const localEdges = new Map(graph.edges.map((edge) => [edge.id, edge]));
	const serverBlocks = new Set(server.blocks.map((block) => block.id));
	const serverEdges = new Set(server.edges.map((edge) => edge.id));

	const repaired: ChangeSet = { blocks: new Map(), edges: new Map() };

	for (const [id, action] of changes.blocks) {
		if (action === "delete") {
			if (!serverBlocks.has(id)) {
				notes.push(`Skipped deleting block ${id}: already gone from the server.`);
				continue;
			}
		} else if (!localBlocks.has(id)) {
			notes.push(`Skipped saving block ${id}: no longer on the canvas.`);
			continue;
		}
		repaired.blocks.set(id, action);
	}

	const deletedBlocks = new Set(
		[...repaired.blocks].filter(([, action]) => action === "delete").map(([id]) => id),
	);
	/** A block an edge may point at: on the server, or being upserted right now. */
	const blockWillExist = (id: string) =>
		(serverBlocks.has(id) || repaired.blocks.get(id) === "upsert") &&
		!deletedBlocks.has(id);

	for (const [id, action] of changes.edges) {
		if (action === "delete") {
			if (!serverEdges.has(id)) {
				notes.push(`Skipped deleting edge ${id}: already gone from the server.`);
				continue;
			}
			repaired.edges.set(id, action);
			continue;
		}

		const edge = localEdges.get(id);
		if (!edge) {
			notes.push(`Skipped saving edge ${id}: no longer on the canvas.`);
			continue;
		}

		// Pull in endpoints the server hasn't seen yet, so the edge has something
		// to attach to.
		for (const endpoint of [edge.from, edge.to]) {
			if (blockWillExist(endpoint)) continue;
			if (localBlocks.has(endpoint) && !deletedBlocks.has(endpoint)) {
				repaired.blocks.set(endpoint, "upsert");
				notes.push(`Also saving block ${endpoint}: edge ${id} depends on it.`);
			}
		}

		if (!blockWillExist(edge.from) || !blockWillExist(edge.to)) {
			notes.push(`Skipped saving edge ${id}: its blocks do not exist.`);
			continue;
		}
		repaired.edges.set(id, action);
	}

	// A block cannot go while the server still has edges hanging off it.
	if (deletedBlocks.size > 0) {
		for (const edge of server.edges) {
			if (!deletedBlocks.has(edge.from) && !deletedBlocks.has(edge.to)) continue;
			if (repaired.edges.get(edge.id) === "delete") continue;
			repaired.edges.set(edge.id, "delete");
			notes.push(`Also deleting edge ${edge.id}: its block is being deleted.`);
		}
	}

	return { payload: buildSavePayload(graph, repaired), notes };
}

export type SaveWithDoctorOptions = {
	graph: CanvasGraph;
	changes: ChangeSet;
	/** Performs the request. Called again with the repaired payload on failure. */
	save: (payload: CanvasSavePayload) => Promise<unknown>;
	/** Reads the server's current graph, used to diagnose the failure. */
	loadServerGraph: () => Promise<CanvasGraph>;
};

export type SaveOutcome = {
	/** True when the first attempt failed and the repaired one succeeded. */
	repaired: boolean;
	notes: string[];
};

/**
 * Saves the delta; on failure diagnoses against the server and retries once with
 * a repaired payload. Throws the original error if the payload came back
 * unchanged (nothing to fix), or the retry's error if the repair also failed —
 * either way the caller surfaces it to the user.
 */
export async function saveWithDoctor({
	graph,
	changes,
	save,
	loadServerGraph,
}: SaveWithDoctorOptions): Promise<SaveOutcome> {
	try {
		await save(buildSavePayload(graph, changes));
		return { repaired: false, notes: [] };
	} catch (error) {
		const server = await loadServerGraph();
		const { payload, notes } = repairSavePayload(graph, changes, server);
		// Nothing was wrong with the payload, so the failure is elsewhere (network,
		// auth, server bug) — retrying the same body would only fail again.
		if (notes.length === 0) throw error;

		await save(payload);
		return { repaired: true, notes };
	}
}
