import { toast } from "@fluxify/components";
import { useCallback } from "react";
import { BLOCK_TYPES } from "./blocks";
import type { useCanvasHistory } from "./history";
import type { BlockEdge, BlockNode } from "./types";

export function useBlockCanvasDelete({
	readOnly,
	history,
}: {
	readOnly: boolean;
	history: ReturnType<typeof useCanvasHistory>;
}) {
	return useCallback(
		async ({
			nodes: deletingNodes,
			edges: deletingEdges,
		}: {
			nodes: BlockNode[];
			edges: BlockEdge[];
		}) => {
			const protectedNodeIds = new Set(
				deletingNodes
					.filter(
						(node) =>
							node.type === BLOCK_TYPES.entrypoint || node.type === BLOCK_TYPES.errorHandler,
					)
					.map((node) => node.id),
			);
			const nodes = deletingNodes.filter((node) => !protectedNodeIds.has(node.id));
			const edges = deletingEdges.filter(
				(edge) => !protectedNodeIds.has(edge.source) && !protectedNodeIds.has(edge.target),
			);

			// Reject protected nodes even when they are part of a keyboard or bulk
			// delete. Returning the remaining candidates lets React Flow delete only
			// the allowed elements.
			if (protectedNodeIds.size > 0) {
				toast.danger("Entrypoint and error handler blocks cannot be deleted.");
			}
			if (nodes.length === 0 && edges.length === 0) return false;
			if (!readOnly) history.commit();
			return { nodes, edges };
		},
		[readOnly, history],
	);
}
