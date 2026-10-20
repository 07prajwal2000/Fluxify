import { invokeError } from "@fluxify/sdk/runtime";
import type { Context } from "../baseBlock";
import type { HandleSpecs } from "../blockHandles";
import type { EmitNode } from "../compiler";
import {
	type BlockMeta,
	type CustomBlockArgs,
	emitBlockCall,
	emitCustomBlock,
	lookupBlock,
	MODULE_BLOCK_DATA_KEYS,
	tracedBlock,
} from "./customBlock";
import { type ExecuteHandle, emitBodyHandles } from "./executeHandle";

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
	executeHandle?: ExecuteHandle,
): Promise<RoutedResult> {
	const scope = tracedBlock(context, type, blockId, false);
	try {
		return await lookupBlock(context, type)(scope.context, { ...args, executeHandle });
	} catch (error) {
		return { successful: false, error };
	} finally {
		scope.close();
	}
}

function assertInvokable(node: EmitNode, meta: BlockMeta, mode: string, outs: readonly string[]) {
	const body = meta.handles?.body.map((b) => b.name) ?? [];
	const error = invokeError(
		mode,
		{ invoke: meta.invoke, out: outs, body },
		{ source: node.has("source"), body: node.edgesFrom().map((e) => e.handle) },
	);
	if (error) throw new Error(`Block ${node.block.id} (${node.block.type}) ${error}`);
}

/** a programmable block: checks its invoke mode, then leaves by the handle `run` returned */
export function emitModuleBlock(node: EmitNode, meta: BlockMeta) {
	const { mode, call } = emitBlockCall(node, MODULE_BLOCK_DATA_KEYS, meta);
	const outs: readonly string[] = meta.handles?.out ?? ["source"];
	assertInvokable(node, meta, mode, outs);
	// async and queued fire and move on, exactly like a canvas custom block; a
	// schema param travels as its definition (a job payload is JSON)
	if (mode !== "sync")
		return emitCustomBlock(node, MODULE_BLOCK_DATA_KEYS, { fieldMapParams: meta.fieldMapParams });

	const r = node.v("r");
	const handles = node.v("handles");
	// a throw goes to `failure` when wired, otherwise fails the run like a builtin (`lib.routeResult`)
	const routed = `lib.routeResult(${JSON.stringify(node.block.type)}, ${JSON.stringify(outs)}, ${r}, ${node.has("failure")})`;
	const route =
		outs.length === 2
			? `if (${r}.handle === "failure") {
${node.next("failure")}
}
${node.next("success")}`
			: node.next();
	return `const ${handles} = ${emitBodyHandles(node, meta)};
let ${r} = await lib.invokeRouted${call.slice(0, -1)}, ${handles});
${r} = ${routed};
${node.in} = ${r}.output;
${route}`;
}
