import { layoutGraph } from "@fluxify/blocks/layout";
import {
	assertNoHandleFanOut,
	canvasAfterChanges,
	canvasChangesFromPayload,
	type BlockBuilderPayload,
	type CanvasChanges,
	type CanvasItems,
	type PreparedCanvas,
} from "./normalize";

/**
 * Merging an agent's canvas output into the canvas it lands on, laying the
 * result out, and previewing it. Split out of `normalize.ts`, which had grown
 * past the complexity cap holding both this and the payload translation.
 */

/** Key order is not significance: the agent rebuilds `data` from what it read,
 *  and a reordered object is the same configuration. */
function stableJson(value: unknown): string {
	return JSON.stringify(value ?? {}, (_key, item) =>
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(
					Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
				)
			: item,
	);
}

/**
 * True when a declared block is the stored block restated — same type, same
 * configuration, differing only in coordinates the agent made up.
 *
 * The output contract asks for NEW blocks in `blocks` and edits in
 * `canvasChanges`, but an agent told to change one thing in a route routinely
 * re-emits the whole canvas. Every re-emitted block then counts as changed, so
 * `anchorOffset` finds no unchanged block to anchor on and re-flows the entire
 * graph from the origin — which is the "it moved everything" a user sees after
 * asking for a one-block edit.
 */
function echoesStored(
	block: { id: string; type: string; data: unknown },
	before: CanvasItems["blocks"][number] | undefined,
): boolean {
	if (!before || before.type !== block.type) return false;
	return stableJson(before.data) === stableJson(block.data);
}

/**
 * Lays the canvas out after the agent's changes are merged into it.
 *
 * The model writes coordinates for a canvas it cannot see, so inserting a block
 * into an existing route left the following block sitting on top of another one.
 * ELK re-flows the merged graph; `changedIds` keeps the blocks the agent did not
 * touch as the frame of reference, so an edit nudges the graph instead of
 * teleporting it, and only blocks that actually move are written back.
 *
 * An existing block that has to move is added to the change set — with its
 * stored type and data, since a position-only upsert would blank the rest.
 */
export async function formatCanvasChanges(
	changes: CanvasChanges,
	existing: CanvasItems,
): Promise<CanvasChanges> {
	const removed = new Set(
		changes.actionsToPerform.blocks
			.filter((b) => b.action === "delete")
			.map((b) => b.id),
	);
	const deletedEdges = new Set(
		changes.actionsToPerform.edges
			.filter((edge) => edge.action === "delete")
			.map((edge) => edge.id),
	);

	const stored = new Map(existing.blocks.map((b) => [b.id, b]));
	// An echo carries coordinates the agent invented for a canvas it cannot see;
	// keeping the stored ones is what stops a block the user never touched from
	// being written back somewhere else.
	const blocksIn = changes.changes.blocks.map((block) =>
		echoesStored(block, stored.get(block.id))
			? { ...block, position: stored.get(block.id)!.position }
			: block,
	);
	// Every declared block is deduped out of the layout input, but only a real
	// edit counts as changed: an echo has to stay available as an anchor.
	const declaredIds = new Set(blocksIn.map((b) => b.id));
	const changedIds = new Set(
		blocksIn
			.filter((b) => !echoesStored(b, stored.get(b.id)))
			.map((b) => b.id),
	);

	const nodes = [
		...existing.blocks.filter(
			(b) => !removed.has(b.id) && !declaredIds.has(b.id),
		),
		...blocksIn,
	].map((b) => ({ id: b.id, type: b.type, position: b.position }));
	if (nodes.length === 0) return changes;

	// Superseded edges are keyed by id, so the agent's version wins.
	const edgeById = new Map(
		existing.edges
			.filter((edge) => !deletedEdges.has(edge.id))
			.map((edge) => [edge.id, edge]),
	);
	for (const edge of changes.changes.edges) edgeById.set(edge.id, edge);
	const edges = [...edgeById.values()].filter(
		(e) => !removed.has(e.from) && !removed.has(e.to),
	);

	const moved = await layoutGraph(nodes, edges, { changedIds });
	if (Object.keys(moved).length === 0) {
		return { ...changes, changes: { ...changes.changes, blocks: blocksIn } };
	}

	const blocks = blocksIn.map((b) =>
		moved[b.id] ? { ...b, position: moved[b.id]! } : b,
	);
	const actions = [...changes.actionsToPerform.blocks];
	for (const block of existing.blocks) {
		const position = moved[block.id];
		if (!position || removed.has(block.id) || declaredIds.has(block.id)) continue;
		blocks.push({
			id: block.id,
			type: block.type,
			data: (block.data ?? {}) as Record<string, unknown>,
			position,
		} as (typeof blocks)[number]);
		actions.push({ id: block.id, action: "upsert" as const });
	}

	return {
		actionsToPerform: { ...changes.actionsToPerform, blocks: actions },
		changes: { ...changes.changes, blocks },
	};
}

/** `canvasChangesFromPayload` + the layout pass, which is what applying wants. */
export async function formattedCanvasChanges(
	payload: BlockBuilderPayload,
	existing: CanvasItems,
): Promise<CanvasChanges> {
	return formatCanvasChanges(canvasChangesFromPayload(payload, existing), existing);
}

/** Build the stable artifact preview before persisting it. */
export async function prepareCanvasArtifact(
	payload: BlockBuilderPayload,
	existing: CanvasItems,
): Promise<PreparedCanvas> {
	const changes = await formattedCanvasChanges(payload, existing);
	const preview = canvasAfterChanges(existing, changes);
	assertNoHandleFanOut(preview);
	return { changes, preview };
}
