import type { ValidatableBlock } from "./schemas";

export function detectCycles(blocks: ValidatableBlock[]): string | null {
	const adjMap = new Map<string, string[]>();

	for (const block of blocks) {
		if (!block || !block.id) continue;
		if (!adjMap.has(block.id)) {
			adjMap.set(block.id, []);
		}
		if (block.connections && Array.isArray(block.connections)) {
			for (const conn of block.connections) {
				if (conn && conn.blockId) {
					adjMap.get(block.id)!.push(conn.blockId);
				}
			}
		}
	}

	const stateMap = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
	const parentPath: string[] = [];

	function dfs(nodeId: string): string | null {
		stateMap.set(nodeId, 1);
		parentPath.push(nodeId);

		const neighbors = adjMap.get(nodeId) || [];
		for (const neighbor of neighbors) {
			const neighborState = stateMap.get(neighbor) || 0;
			if (neighborState === 1) {
				const cycleStartIndex = parentPath.indexOf(neighbor);
				const cyclePath = parentPath
					.slice(cycleStartIndex)
					.concat(neighbor)
					.join(" -> ");
				return `Detected a cyclic loop dependency in the workflow canvas graph: ${cyclePath}. Workflow DAGs must not contain circular node connections. Please remove circular connections.`;
			}
			if (neighborState === 0) {
				const error = dfs(neighbor);
				if (error) return error;
			}
		}

		stateMap.set(nodeId, 2);
		parentPath.pop();
		return null;
	}

	for (const nodeId of adjMap.keys()) {
		if ((stateMap.get(nodeId) || 0) === 0) {
			const cycleError = dfs(nodeId);
			if (cycleError) return cycleError;
		}
	}

	return null;
}
