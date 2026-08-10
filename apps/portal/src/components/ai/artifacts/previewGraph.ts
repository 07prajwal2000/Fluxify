import {
	canvasChangesFromPayload,
	type BlockBuilderPayload,
	type CanvasItems,
} from "@fluxify/ai-gateway/src/api/v1/harness-conversations/artifacts/normalize";
import type { BlockData, CanvasGraph } from "@/components/canvas/types";

export type { BlockBuilderPayload };

/**
 * What the canvas would look like once this output is applied: the stored graph
 * with the agent's blocks upserted onto it and its removals taken out. Reuses
 * the server's own normalizer so the preview cannot drift from what apply does.
 * Ids for new blocks are minted per call — memoize on the inputs.
 */
export function previewGraph(
	payload: BlockBuilderPayload,
	existing: CanvasItems,
): CanvasGraph {
	const { actionsToPerform, changes } = canvasChangesFromPayload(payload, existing);
	const deleted = new Set(
		actionsToPerform.blocks.filter((a) => a.action === "delete").map((a) => a.id),
	);

	const blocks = new Map(
		existing.blocks.filter((b) => !deleted.has(b.id)).map((b) => [b.id, b]),
	);
	for (const block of changes.blocks) blocks.set(block.id, block);

	// an edge of a deleted block goes with it (the FK cascades)
	const edges = new Map(
		existing.edges
			.filter((e) => !deleted.has(e.from) && !deleted.has(e.to))
			.map((e) => [e.id, e]),
	);
	for (const edge of changes.edges) edges.set(edge.id, edge);

	return {
		blocks: [...blocks.values()].map((b) => ({
			id: b.id,
			type: b.type,
			position: b.position,
			data: (b.data ?? {}) as BlockData,
		})),
		edges: [...edges.values()].map((e) => ({
			id: e.id,
			from: e.from,
			to: e.to,
			fromHandle: e.fromHandle ?? `${e.from}-source`,
			toHandle: e.toHandle ?? `${e.to}-target`,
		})),
	};
}
