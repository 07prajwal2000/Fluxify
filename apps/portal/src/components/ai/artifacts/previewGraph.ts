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
	isApplied = false,
): CanvasGraph {
	// The proposal remains stored after apply, while `existing` has become the
	// live result of that same proposal. Replaying it here mints fresh preview
	// ids and renders a second visual copy, even though apply correctly no-ops.
	if (isApplied) {
		return {
			blocks: existing.blocks.map((block) => ({
				...block,
				data: (block.data ?? {}) as BlockData,
			})),
			edges: existing.edges.map((edge) => ({
				...edge,
				fromHandle: edge.fromHandle ?? `${edge.from}-source`,
				toHandle: edge.toHandle ?? `${edge.to}-target`,
			})),
		};
	}

	// Canvas artifacts are materialized before persistence. Render that frozen
	// plan during review so a later live-canvas read cannot make the artifact
	// look different from what the user is approving.
	if (payload.preparedCanvas?.preview) {
		const preview = payload.preparedCanvas.preview;
		return {
			blocks: preview.blocks.map((block) => ({
				...block,
				data: (block.data ?? {}) as BlockData,
			})),
			edges: preview.edges.map((edge) => ({
				...edge,
				fromHandle: edge.fromHandle ?? `${edge.from}-source`,
				toHandle: edge.toHandle ?? `${edge.to}-target`,
			})),
		};
	}

	const { actionsToPerform, changes } = canvasChangesFromPayload(payload, existing);
	const deleted = new Set(
		actionsToPerform.blocks.filter((a) => a.action === "delete").map((a) => a.id),
	);
	const deletedEdges = new Set(
		actionsToPerform.edges
			.filter((action) => action.action === "delete")
			.map((action) => action.id),
	);

	const blocks = new Map(
		existing.blocks.filter((b) => !deleted.has(b.id)).map((b) => [b.id, b]),
	);
	for (const block of changes.blocks) blocks.set(block.id, block);

	// an edge of a deleted block goes with it (the FK cascades)
	const edges = new Map(
		existing.edges
			.filter(
				(e) =>
					!deletedEdges.has(e.id) && !deleted.has(e.from) && !deleted.has(e.to),
			)
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
