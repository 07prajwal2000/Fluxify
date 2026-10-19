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

/** What a programmable block's `run` gets to call the chains on its body handles. */
export type ExecuteHandle = {
	(handle: string, input?: unknown, opts?: { branch: string }): Promise<unknown>;
	branches(handle: string): { id: string; label: string }[];
};

/** an `allowMultiple` branch that threw, in its slot of the results (allSettled) */
export type FailedBranch = { error: unknown };

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
 * closure over it (the agent's tools).
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
	const handleOf = (name: string) => {
		const handle = Object.hasOwn(handles, name) ? handles[name] : undefined;
		if (handle) return handle;
		const known = Object.keys(handles).join(", ") || "none";
		throw new Error(`Block ${type} has no body handle '${name}'; body handles: ${known}`);
	};
	const run = async (branch: Branch, input: unknown) =>
		((await branch.run(input, owned)) as Record<symbol, unknown> | undefined)?.[end];

	const executeHandle = async (name: string, input?: unknown, opts?: { branch: string }) => {
		if (lifetime?.ended) throw new Error(`executeHandle('${name}') called after the run ended`);
		const { multiple, branches } = handleOf(name);
		if (opts?.branch !== undefined) {
			const branch =
				branches.find((b) => b.id === opts.branch) ?? branches.find((b) => b.label === opts.branch);
			if (!branch)
				throw new Error(`Block ${type} has no branch '${opts.branch}' on handle '${name}'`);
			return run(branch, input);
		}
		if (!multiple) return branches[0] && run(branches[0], input);
		const settled = await Promise.allSettled(branches.map((branch) => run(branch, input)));
		return settled.map((s): unknown =>
			s.status === "fulfilled" ? s.value : ({ error: s.reason } satisfies FailedBranch),
		);
	};
	return Object.assign(executeHandle, {
		branches: (name: string) => handleOf(name).branches.map(({ id, label }) => ({ id, label })),
	});
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
