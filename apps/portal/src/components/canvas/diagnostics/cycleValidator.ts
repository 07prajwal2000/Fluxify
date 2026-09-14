import { findCycleEdgeIds } from "../cycleDetection";
import type { CanvasEdge, CanvasGraph } from "../types";
import type { BlockDiagnostic } from "./types";

export const CYCLE_DETECTION_SOURCE = "cycle-detection";

/**
 * Validates a graph for cyclic loops and emits error diagnostics for every
 * block participating in a cycle.
 */
export function validateCycles(graph: CanvasGraph | { edges: Iterable<CanvasEdge> }): BlockDiagnostic[] {
	const cycleEdgeIds = findCycleEdgeIds(graph.edges);
	if (cycleEdgeIds.size === 0) return [];

	const cyclicBlockIds = new Set<string>();
	for (const edge of graph.edges) {
		if (cycleEdgeIds.has(edge.id)) {
			cyclicBlockIds.add(edge.from);
			cyclicBlockIds.add(edge.to);
		}
	}

	const diagnostics: BlockDiagnostic[] = [];
	for (const blockId of cyclicBlockIds) {
		diagnostics.push({
			blockId,
			severity: "error",
			message: "Block is part of a cyclic loop. Cycles are not permitted.",
			source: CYCLE_DETECTION_SOURCE,
		});
	}

	return diagnostics;
}
