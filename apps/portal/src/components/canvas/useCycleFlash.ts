import { useEffect, useMemo, useRef, useState } from "react";
import { flowToGraph } from "./adapters";
import { findCycleEdgeIds } from "./cycleDetection";
import type { BlockEdge, BlockNode } from "./types";

/** How long a rejected save keeps the offending path lit. */
const FLASH_MS = 1_500;

/**
 * Marks the edges that form a cycle, and briefly flashes them when a save is
 * rejected for containing one.
 *
 * Cycles are shown rather than prevented: a user who cannot see the whole
 * invalid path cannot tell which connection to remove.
 */
export function useCycleFlash(
	nodes: BlockNode[],
	edges: BlockEdge[],
	/** Increment to flash. `0` means "nothing has been rejected yet". */
	token: number,
): BlockEdge[] {
	const [flashing, setFlashing] = useState<Set<string>>(new Set());
	const timeout = useRef<number | undefined>(undefined);
	// Read through a ref so the flash isn't re-armed on every graph edit.
	const latest = useRef({ nodes, edges });
	latest.current = { nodes, edges };

	useEffect(() => {
		if (token === 0) return;
		setFlashing(
			findCycleEdgeIds(
				flowToGraph(latest.current.nodes, latest.current.edges).edges,
			),
		);
		if (timeout.current) window.clearTimeout(timeout.current);
		timeout.current = window.setTimeout(() => setFlashing(new Set()), FLASH_MS);
		return () => {
			if (timeout.current) window.clearTimeout(timeout.current);
		};
	}, [token]);

	return useMemo(() => {
		const cycleEdgeIds = findCycleEdgeIds(flowToGraph(nodes, edges).edges);
		return edges.map((edge) => ({
			...edge,
			data: {
				...edge.data,
				cycle: cycleEdgeIds.has(edge.id),
				cycleFlash: flashing.has(edge.id),
			},
		}));
	}, [nodes, edges, flashing]);
}
