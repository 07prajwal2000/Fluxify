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
 * Single seam between "a route matched" and "the graph ran".
 *
 * The default builds and walks the DAG from the database on every request. A
 * compiled worker installs an executor that runs pre-compiled JavaScript
 * instead, and never loads the database module at all — which is why the
 * fallback is imported lazily rather than at the top of this file.
 */
export function setBlocksExecutor(next: BlocksExecutor) {
	executor = next;
}

export async function runBlocks(target: ExecutionTarget, context: Context) {
	if (!executor) {
		const { startBlocksExecution } = await import("../../loaders/blocksLoader");
		executor = (t, ctx) =>
			startBlocksExecution(
				{ routeId: t.routeId, projectId: t.projectId, projectName: t.projectName },
				ctx,
			);
	}
	return executor(target, context);
}
