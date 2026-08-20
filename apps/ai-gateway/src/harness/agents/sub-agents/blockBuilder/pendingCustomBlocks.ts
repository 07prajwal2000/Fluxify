import { withCustomBlockPrefix } from "@fluxify/lib";
import type {
	CustomBlockConfigAgentResult,
	GlobalGraphState,
	Task,
} from "../../../types";

export interface PendingCustomBlock {
	/** The name this block will be *stored* under, prefix included. The config
	 *  agent emits a bare snake_case name and the create endpoint namespaces it,
	 *  so a reference to the bare form resolves nowhere once applied. */
	name: string;
	customBlockId: string;
	inputParams: Array<Record<string, unknown>>;
}

/**
 * Every task `taskId` transitively depends on.
 *
 * Transitive, not direct: a route canvas task names the custom block's *canvas*
 * task as its dependency, and the block's name and caller params live one hop
 * further back on the config task that canvas depends on. Depending on B, which
 * depends on A, still means A applies first — so widening the lookup this way
 * cannot admit a block the apply order will not have created yet.
 */
function dependencyClosure(state: GlobalGraphState, taskId: string): Set<string> {
	const byId = new Map<string, Task>(
		(state.orchestratorState?.tasks ?? []).map((task) => [task.id, task]),
	);
	// The task list is written by the task generator; `activeTask` is the only
	// task guaranteed present when validating a run resumed mid-flight.
	if (state.activeTask && !byId.has(state.activeTask.id)) {
		byId.set(state.activeTask.id, state.activeTask);
	}

	const seen = new Set<string>();
	const queue = [...(byId.get(taskId)?.dependsOnAgentId ?? [])];
	while (queue.length > 0) {
		const id = queue.pop() as string;
		if (seen.has(id)) continue;
		seen.add(id);
		queue.push(...(byId.get(id)?.dependsOnAgentId ?? []));
	}
	return seen;
}

/**
 * Custom blocks this run has proposed but has not written to the database yet.
 *
 * A single message that creates a custom block and uses it in a route produces
 * two sibling tasks: the block is still a proposal sitting in `subAgentResults`
 * when the route's canvas is validated, so a database-only lookup misses it and
 * rejects a correct canvas. This is the one source both the prompt contract and
 * the validator read, so they cannot disagree about whether the block exists.
 *
 * Scoped to the declared dependency graph on purpose: a task that binds to a
 * block it never declared a dependency on would pass validation here and then
 * apply in the wrong order.
 */
export function pendingCustomBlocks(
	state: GlobalGraphState,
	taskId: string,
): PendingCustomBlock[] {
	const results = state.orchestratorState?.subAgentResults ?? {};
	const pending: PendingCustomBlock[] = [];

	for (const id of dependencyClosure(state, taskId)) {
		const result = results[id] as CustomBlockConfigAgentResult | undefined;
		if (!result?.customBlockId || !result.data?.name) continue;
		// A block this run is deleting is not one a sibling may bind to.
		if (result.action === "delete") continue;
		pending.push({
			name: withCustomBlockPrefix(result.data.name),
			customBlockId: result.customBlockId,
			inputParams: result.data.inputParams ?? [],
		});
	}

	return pending;
}

/** The same proposals shaped like `getCustomBlocksBatch`, for merging under it. */
export function pendingCustomBlockSchemas(
	state: GlobalGraphState,
	taskId: string,
): Map<string, Array<Record<string, unknown>>> {
	return new Map(
		pendingCustomBlocks(state, taskId).map((block) => [
			block.name,
			block.inputParams,
		]),
	);
}
