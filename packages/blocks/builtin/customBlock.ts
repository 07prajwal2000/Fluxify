import z from "zod";
import { BaseBlock, BlockOptions, BlockOutput, Context } from "../baseBlock";
import { Engine } from "../engine";
import { logger } from "@fluxify/common";
import type { BlockDTOType, EdgeDTOSchemaType } from "../builderTypes";
import {
	compileGraph,
	emitJsObject,
	instantiateCompiled,
	type EmitNode,
} from "../compiler";

export const customBlockInvokeSchema = z
	.enum(["sync", "async"])
	.default("sync")
	.describe(
		"sync waits for the custom block and takes its output; async fires it and moves on",
	);

export type CompiledCustomBlock = (ctx: Context, input?: any) => Promise<any>;

/**
 * Worker-global library of compiled custom blocks, keyed by block type name.
 *
 * Custom blocks are reusable across every route in the worker, so they are
 * compiled once at worker start (or on a reload signal) rather than re-emitted
 * into each graph that calls them. A graph that uses one emits `lib.invoke`
 * against this map, so recompiling a route never recompiles its dependencies.
 */
const customBlockLibrary = new Map<string, CompiledCustomBlock>();

/** compile a custom block's graph once and publish it to the worker */
export function registerCustomBlock(
	name: string,
	blocks: BlockDTOType[],
	edges: EdgeDTOSchemaType,
) {
	const { run, source } = compileGraph(blocks, edges, { asCustomBlock: true });
	customBlockLibrary.set(name, run);
	return source;
}

/**
 * Publish already-compiled source. This is the path workers take: they receive
 * the JS from the artifact store and never run the compiler themselves.
 */
export function registerCompiledCustomBlock(name: string, source: string) {
	customBlockLibrary.set(name, instantiateCompiled(source));
}

export function unregisterCustomBlock(name: string) {
	customBlockLibrary.delete(name);
}

export function hasCustomBlock(name: string) {
	return customBlockLibrary.has(name);
}

export function customBlockNames() {
	return [...customBlockLibrary.keys()];
}

function lookup(name: string): CompiledCustomBlock {
	const compiled = customBlockLibrary.get(name);
	if (!compiled) throw new Error(`Custom block not loaded: ${name}`);
	return compiled;
}

/**
 * A nested graph shares the caller's Context, so without this its spans would
 * land flat in the parent trace with nothing saying which block invoked them or
 * which canvas their block ids belong to. `blockId` is the invoking block.
 */
function traced(
	context: Context,
	name: string,
	blockId: string | undefined,
	detached: boolean,
) {
	if (!context.trace || !blockId) return { context, close: () => {} };
	const scope = context.trace.enterCustomBlock({ blockId, name, detached });
	// a detached invocation records into its own trace, so it needs its own
	// context — mutating the caller's would follow the request back out
	const child =
		scope.trace === context.trace ? context : { ...context, trace: scope.trace };
	return { context: child, close: () => scope.close() };
}

/** sync: wait for the custom block and hand back its output */
export async function invokeCustomBlock(
	context: Context,
	name: string,
	params: any,
	blockId?: string,
) {
	const scope = traced(context, name, blockId, false);
	try {
		const result = await lookup(name)(scope.context, params);
		return result?.output;
	} finally {
		scope.close();
	}
}

/**
 * async: fire and forget. The caller moves on with its own value, and a failure
 * is logged rather than left as an unhandled rejection — one bad custom block
 * must not take the worker down.
 */
export function invokeCustomBlockAsync(
	context: Context,
	name: string,
	params: any,
	blockId?: string,
) {
	const scope = traced(context, name, blockId, true);
	lookup(name)(scope.context, params)
		.catch((error) => {
			logger.error(`Async custom block '${name}' failed`, "BLOCKS.customBlock", {
				error,
			});
		})
		.finally(() => scope.close());
}

export function emitCustomBlock(node: EmitNode) {
	const { blockName, blockDescription, invoke, ...params } = (node.block.data ??
		{}) as Record<string, unknown>;
	const mode = customBlockInvokeSchema.parse(invoke);
	const name = JSON.stringify(node.block.type);
	// same shape the interpreted block passes: evaluated params plus the input
	const args = `{ ...${emitJsObject(params, node)}, input: ${node.in} }`;
	const id = JSON.stringify(node.block.id);

	if (mode === "async") {
		return `lib.invokeAsync(ctx, ${name}, ${args}, ${id});\n${node.next()}`;
	}
	return `${node.in} = await lib.invoke(ctx, ${name}, ${args}, ${id});\n${node.next()}`;
}

export class CustomBlock extends BaseBlock {
	constructor(
		context: Context,
		input: any,
		protected readonly subEngine: Engine,
		protected readonly entrypointId: string,
		next?: string,
	) {
		super(context, input, next);
	}

	override async executeAsync(
		params?: any,
		options?: BlockOptions,
	): Promise<BlockOutput> {
		const evaluatedInput = await this.evaluateInput(this.input, params);
		const mergedParams = {
			...evaluatedInput,
			input: params
		};
		const result = await this.subEngine.start(this.entrypointId, mergedParams);

		// If successful or if an error was successfully handled internally,
		// continueIfFail will determine next steps, otherwise we propagate error.
		return {
			continueIfFail: result?.continueIfFail ?? false,
			successful: result?.successful ?? true,
			next: result?.next ? result.next : this.next,
			output: result?.output,
			error: result?.error,
		};
	}

	private async evaluateInput(input: any, params: any) {
		if (!input || typeof input !== "object") return input;
		const evaluated: any = {};
		for (const key in input) {
			const val = input[key];
			if (typeof val === "string" && val.startsWith("js:")) {
				evaluated[key] = await this.context.vm.runAsync(val.slice(3), params);
			} else {
				evaluated[key] = val;
			}
		}
		return evaluated;
	}
}
