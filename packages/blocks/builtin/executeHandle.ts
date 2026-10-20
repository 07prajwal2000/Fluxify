import { createExecuteHandle, type ExecuteHandle, type FailedBranch } from "@fluxify/sdk/runtime";
import { type BlockTrace, blockName, type Context } from "../baseBlock";
import { sortByOrder } from "../blockHandles";
import { BlockTypes } from "../blockTypes";
import type { EmitNode } from "../compiler";
import type { BlockMeta } from "./customBlock";

/** the compiled run's `$state`; only what this module reads */
type RunState = { ctx: Context; trace?: BlockTrace };

type Branch = {
	id: string;
	label: string;
	/** resolves to the chain's `$endBranch` wrapper */
	run: (input: unknown, state: RunState) => Promise<unknown>;
};
type BodyHandles = Record<string, { multiple: boolean; branches: Branch[] }>;

export type { ExecuteHandle, FailedBranch };

/**
 * Spans of a chain run through `executeHandle` name the block that owns the
 * handle, even when the call comes after that block returned. The innermost
 * owner wins, so a body chain inside a body chain keeps its own.
 */
const ownedBy = (trace: BlockTrace, owner: string): BlockTrace => ({
	recordSpan: (span) => trace.recordSpan({ ...span, owner: span.owner ?? owner }),
	enterCustomBlock: (invocation) => trace.enterCustomBlock(invocation),
});

/**
 * The `executeHandle` one invocation of a programmable block gets. It keeps the
 * run's state (shared with concurrent calls, like orchestrator branches) and
 * stays callable until the outermost run ends, so a block can hand out a
 * closure over it (the agent's tools). The call semantics are the SDK's, shared
 * with the test harness.
 */
export function bodyHandles(
	state: RunState,
	type: string,
	blockId: string,
	handles: BodyHandles,
	end: symbol,
): ExecuteHandle {
	const lifetime = state.ctx.lifetime;
	const owned = state.trace ? { ...state, trace: ownedBy(state.trace, blockId) } : state;
	const chains = Object.fromEntries(
		Object.entries(handles).map(([name, { multiple, branches }]) => [
			name,
			{
				multiple,
				branches: branches.map(({ id, label, run }) => ({
					id,
					label,
					run: async (input: unknown) =>
						((await run(input, owned)) as Record<symbol, unknown> | undefined)?.[end],
				})),
			},
		]),
	);
	return createExecuteHandle(type, chains, () => !!lifetime?.ended);
}

/**
 * A body chain has nothing to return to the plugin once a terminal block ends
 * the route from inside it, so v1 rejects one at compile time. A rollback is
 * fine inside a transaction the chain opens itself: that transaction catches it.
 */
function assertNoTerminal(node: EmitNode, handle: string) {
	const seen = new Set<string>();
	const walk = (edges: ReturnType<EmitNode["edgesFrom"]>, inTransaction: boolean) => {
		for (const { to } of edges) {
			if (seen.has(to.id)) continue;
			seen.add(to.id);
			const rollback = to.type === BlockTypes.db_rollback && !inTransaction;
			if (to.type === BlockTypes.response || rollback)
				throw new Error(
					`Block ${to.id} (${to.type}) is terminal, so it cannot be in the chain on body handle '${handle}' of block ${node.block.id} (${node.block.type})`,
				);
			const opens = to.type === BlockTypes.db_transaction;
			for (const next of node.edgesFrom(to.id))
				walk([next], inTransaction || (opens && next.handle === "executor"));
		}
	};
	walk(
		node.edgesFrom().filter((e) => e.handle === handle),
		false,
	);
}

/**
 * The `executeHandle` argument for a programmable block: every body handle's
 * chains as closures over the block functions they start at. A branch takes
 * its `$state` as an argument so the owner's trace can be swapped in.
 */
export function emitBodyHandles(node: EmitNode, meta: BlockMeta) {
	const data = node.block.data as { order?: unknown } | undefined;
	// an allowMultiple handle's branches run in canvas order, like the orchestrator's
	const order = Array.isArray(data?.order) ? (data.order as string[]) : [];
	const handles = (meta.handles?.body ?? []).map(({ name, allowMultiple }) => {
		assertNoTerminal(node, name);
		const targets = node.edgesFrom().filter((e) => e.handle === name);
		const branches = sortByOrder(targets, order, (e) => e.to.id).map(({ to }) => {
			const label = blockName(to.data) || to.type;
			return `{ id: ${JSON.stringify(to.id)}, label: ${JSON.stringify(label)}, run: ($input, $state) => ${node.call(to.id, "$input", "$endBranch")} }`;
		});
		return `${JSON.stringify(name)}: { multiple: ${!!allowMultiple}, branches: [${branches.join(", ")}] }`;
	});
	return `lib.bodyHandles($state, ${JSON.stringify(node.block.type)}, ${JSON.stringify(node.block.id)}, {${handles.length ? `\n${handles.join(",\n")}\n` : ""}}, $branchEnd)`;
}
