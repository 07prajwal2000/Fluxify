import type { BlockOutput, Context } from "@fluxify/blocks";

export type ExecutionTarget = {
	routeId: string;
	projectId: string;
	projectName: string;
};

export type BlocksExecutor = (
	target: ExecutionTarget,
	context: Context,
) => Promise<BlockOutput | null>;

let executor: BlocksExecutor | null = null;

/**
 * Single seam between "a route matched" and "the graph ran". A compiled
 * worker (or a test harness) installs the executor that runs pre-compiled
 * JavaScript for the route before any request reaches `runBlocks`.
 */
export function setBlocksExecutor(next: BlocksExecutor) {
	executor = next;
}

export async function runBlocks(target: ExecutionTarget, context: Context) {
	if (!executor) {
		throw new Error("No blocks executor installed — call setBlocksExecutor first");
	}
	return executor(target, context);
}
