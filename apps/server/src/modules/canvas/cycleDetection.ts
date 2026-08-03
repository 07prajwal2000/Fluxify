/** A directed edge in a canvas graph. Null endpoints are ignored. */
export type DirectedCanvasEdge = {
	id: string;
	from: string | null | undefined;
	to: string | null | undefined;
};

/**
 * Finds every edge that belongs to a directed cycle using depth-first search.
 *
 * Each back edge closes a cycle. The active DFS path between its target and
 * source, plus that back edge, is exactly the participating cycle path. The
 * union covers multiple and overlapping cycles without flagging feeder edges.
 */
export function findCycleEdgeIds(edges: Iterable<DirectedCanvasEdge>): Set<string> {
	const outgoing = new Map<string, DirectedCanvasEdge[]>();
	const nodes = new Set<string>();

	for (const edge of edges) {
		if (!edge.from || !edge.to) continue;
		nodes.add(edge.from);
		nodes.add(edge.to);
		const list = outgoing.get(edge.from) ?? [];
		list.push(edge);
		outgoing.set(edge.from, list);
	}

	const visited = new Set<string>();
	const activeIndex = new Map<string, number>();
	const pathEdges: DirectedCanvasEdge[] = [];
	const cycleEdgeIds = new Set<string>();

	const visit = (node: string) => {
		visited.add(node);
		activeIndex.set(node, pathEdges.length);

		for (const edge of outgoing.get(node) ?? []) {
			const targetIndex = activeIndex.get(edge.to!);
			if (targetIndex !== undefined) {
				for (let i = targetIndex; i < pathEdges.length; i++)
					cycleEdgeIds.add(pathEdges[i].id);
				cycleEdgeIds.add(edge.id);
				continue;
			}
			if (visited.has(edge.to!)) continue;

			pathEdges.push(edge);
			visit(edge.to!);
			pathEdges.pop();
		}

		activeIndex.delete(node);
	};

	for (const node of nodes) if (!visited.has(node)) visit(node);
	return cycleEdgeIds;
}
