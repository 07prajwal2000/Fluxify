import type { CanvasEdge } from "./types";

/**
 * Returns every edge in a directed cycle with depth-first search.
 *
 * A back edge closes a cycle. Its active DFS path and itself are the cycle, so
 * only loop paths are highlighted; edges that merely lead into a loop are not.
 */
export function findCycleEdgeIds(edges: Iterable<CanvasEdge>): Set<string> {
	const outgoing = new Map<string, CanvasEdge[]>();
	const nodes = new Set<string>();

	for (const edge of edges) {
		nodes.add(edge.from);
		nodes.add(edge.to);
		const list = outgoing.get(edge.from) ?? [];
		list.push(edge);
		outgoing.set(edge.from, list);
	}

	const visited = new Set<string>();
	const activeIndex = new Map<string, number>();
	const pathEdges: CanvasEdge[] = [];
	const cycleEdgeIds = new Set<string>();

	const visit = (node: string) => {
		visited.add(node);
		activeIndex.set(node, pathEdges.length);

		for (const edge of outgoing.get(node) ?? []) {
			const targetIndex = activeIndex.get(edge.to);
			if (targetIndex !== undefined) {
				for (let i = targetIndex; i < pathEdges.length; i++)
					cycleEdgeIds.add(pathEdges[i].id);
				cycleEdgeIds.add(edge.id);
				continue;
			}
			if (visited.has(edge.to)) continue;

			pathEdges.push(edge);
			visit(edge.to);
			pathEdges.pop();
		}

		activeIndex.delete(node);
	};

	for (const node of nodes) if (!visited.has(node)) visit(node);
	return cycleEdgeIds;
}
