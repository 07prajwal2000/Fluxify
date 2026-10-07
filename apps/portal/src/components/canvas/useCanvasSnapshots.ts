import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback } from "react";
import type { useChangeTracker } from "./changes";
import type { CanvasSnapshot } from "./history";
import type { BlockEdge, BlockNode } from "./types";

export function useCanvasSnapshots({
	latest,
	tracker,
	pendingEmit,
	setNodes,
	setEdges,
}: {
	latest: MutableRefObject<{ nodes: BlockNode[]; edges: BlockEdge[] }>;
	tracker: ReturnType<typeof useChangeTracker>;
	pendingEmit: MutableRefObject<boolean>;
	setNodes: Dispatch<SetStateAction<BlockNode[]>>;
	setEdges: Dispatch<SetStateAction<BlockEdge[]>>;
}) {
	const getSnapshot = useCallback((): CanvasSnapshot => {
		return { nodes: latest.current.nodes, edges: latest.current.edges };
	}, [latest]);

	// Existing blocks keep live config data; restored blocks get saved data.
	const applySnapshot = useCallback(
		(snapshot: CanvasSnapshot) => {
			pendingEmit.current = true;
			const snapshotNodeIds = new Set(snapshot.nodes.map((node) => node.id));
			const currentNodeIds = new Set(latest.current.nodes.map((node) => node.id));
			const restored = new Set(snapshot.edges.map((edge) => edge.id));
			tracker.markUpserted("blocks", snapshotNodeIds);
			tracker.markDeleted(
				"blocks",
				[...currentNodeIds].filter((id) => !snapshotNodeIds.has(id)),
			);
			tracker.markUpserted("edges", restored);
			tracker.markDeleted(
				"edges",
				latest.current.edges.filter((edge) => !restored.has(edge.id)).map((edge) => edge.id),
			);
			setNodes((current) => {
				const byId = new Map(current.map((node) => [node.id, node]));
				return snapshot.nodes.map((node) => {
					const existing = byId.get(node.id);
					return existing ? { ...node, data: existing.data } : node;
				});
			});
			setEdges(snapshot.edges);
		},
		[latest, setNodes, setEdges, tracker, pendingEmit],
	);

	return { getSnapshot, applySnapshot };
}
