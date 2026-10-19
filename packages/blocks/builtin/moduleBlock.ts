import type { Context } from "../baseBlock";
import type { HandleSpecs } from "../blockHandles";
import type { EmitNode } from "../compiler";
import {
	type BlockMeta,
	type CustomBlockArgs,
	customBlockInvokeSchema,
	emitBlockCall,
	emitCustomBlock,
	lookupBlock,
	tracedBlock,
} from "./customBlock";

/**
 * Block metadata by type (plugin manifests): all the compiler knows of a
 * programmable block. Admin compiles without loading plugin code, so it cannot
 * look the block up in the run library; the handle specs derive from this too.
 */
export type BlockMetas = Readonly<Record<string, BlockMeta | undefined>>;

export const handleSpecsOf = (metas: BlockMetas): HandleSpecs =>
	Object.fromEntries(Object.entries(metas).map(([type, meta]) => [type, meta?.handles]));

export type RoutedResult = {
	successful: boolean;
	output?: unknown;
	handle?: string;
	error?: unknown;
};

/**
 * sync, routed: the block's whole result, so the graph can leave by the handle
 * it returned. A block not loaded reports as a failure, like a throw.
 */
export async function invokeRouted(
	context: Context,
	type: string,
	args: CustomBlockArgs,
	blockId?: string,
): Promise<RoutedResult> {
	const scope = tracedBlock(context, type, blockId, false);
	try {
		return await lookupBlock(context, type)(scope.context, args);
	} catch (error) {
		return { successful: false, error };
	} finally {
		scope.close();
	}
}

function assertInvokable(node: EmitNode, meta: BlockMeta, mode: string, outs: readonly string[]) {
	const label = `Block ${node.block.id} (${node.block.type})`;
	const allowed: readonly string[] =
		// read at call time: customBlock -> compiler -> this module is an import cycle
		meta.invoke ?? customBlockInvokeSchema.unwrap().options;
	if (!allowed.includes(mode))
		throw new Error(`${label} cannot be invoked ${mode}; allowed: ${allowed.join(", ")}`);
	// the caller never learns the outcome, so there is no branch to take
	if (mode !== "sync" && outs.length === 2)
		throw new Error(
			`${label} has success/failure outputs, so it must be invoked sync, not ${mode}`,
		);
	if (!outs.length && node.has("source"))
		throw new Error(`${label} is terminal but has an outgoing edge`);
}

/** a programmable block: checks its invoke mode, then leaves by the handle `run` returned */
export function emitModuleBlock(node: EmitNode, meta: BlockMeta) {
	const { mode, call } = emitBlockCall(node);
	const outs: readonly string[] = meta.handles?.out ?? ["source"];
	assertInvokable(node, meta, mode, outs);
	// async and queued fire and move on, exactly like a canvas custom block
	if (mode !== "sync") return emitCustomBlock(node);

	const r = node.v("r");
	const branching = outs.length === 2;
	const error = `(${r}.error instanceof Error ? ${r}.error : new Error(String(${r}.error)))`;
	// a throw goes to `failure` when wired, otherwise fails the run like a builtin
	const onError =
		branching && node.has("failure")
			? `${node.in} = ${error}.message;\n${node.next("failure")}`
			: `throw ${error};`;
	const expected = outs.length ? outs.join(", ") : "none (terminal block)";
	const unknown = `Block ${node.block.type} returned unknown handle '`;
	const route = branching
		? `if (${r}.handle === "failure") {\n${node.next("failure")}\n}\n${node.next("success")}`
		: node.next();
	return `const ${r} = await lib.invokeRouted${call};
if (!${r}.successful) {
${onError}
}
if (${r}.handle !== undefined && !${JSON.stringify(outs)}.includes(${r}.handle))
throw new Error(${JSON.stringify(unknown)} + ${r}.handle + ${JSON.stringify(`'; expected: ${expected}`)});
${node.in} = ${r}.output;
${route}`;
}
