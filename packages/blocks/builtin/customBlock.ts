import { logger } from "@fluxify/common";
import z from "zod";
import type { BlockOutput, Context } from "../baseBlock";
import type { BlockDTOType, EdgeDTOSchemaType } from "../builderTypes";
import { compileGraph, type EmitNode, emitJsObject, instantiateCompiled } from "../compiler";
import { enqueueJob } from "../jobs";

export const customBlockInvokeSchema = z
	.enum(["sync", "async", "queued"])
	.default("sync")
	.describe(
		"sync waits for the custom block and takes its output; async fires it on this worker and moves on; queued hands it to the job queue for another worker to run",
	);

/** The job kind a queued custom block travels under. */
export const CUSTOM_BLOCK_JOB = "custom-block";

export type CompiledCustomBlock = (ctx: Context, input?: any) => Promise<any>;

/**
 * Worker-global library of compiled custom blocks, keyed `projectId:name`.
 *
 * Custom blocks are reusable across every route in the worker, so they are
 * compiled once at worker start (or on a reload signal) rather than re-emitted
 * into each graph that calls them. A graph that uses one emits `lib.invoke`
 * against this map, so recompiling a route never recompiling its dependencies.
 *
 * A name is only unique inside its project, and a `*` worker serves many, so
 * the project is part of the key. A call site resolves it from `ctx.projectId`
 * at lookup rather than carrying it in the emitted code: published artifacts
 * keep working unchanged, and a nested block shares its caller's context, so it
 * stays in the caller's project.
 */
const customBlockLibrary = new Map<string, CompiledCustomBlock>();
/** key -> the block's own id, so a trace can say which canvas a nested span belongs to (#254) */
const customBlockIds = new Map<string, string>();

const customBlockKey = (projectId: string, name: string) => `${projectId}:${name}`;

function publish(projectId: string, name: string, run: CompiledCustomBlock, id?: string) {
	const key = customBlockKey(projectId, name);
	customBlockLibrary.set(key, run);
	if (id) customBlockIds.set(key, id);
	else customBlockIds.delete(key);
}

/** compile a custom block's graph once and publish it to the worker */
export function registerCustomBlock(
	projectId: string,
	name: string,
	blocks: BlockDTOType[],
	edges: EdgeDTOSchemaType,
	id?: string,
) {
	const { run, source } = compileGraph(blocks, edges, { asCustomBlock: true, projectId });
	publish(projectId, name, run, id);
	return source;
}

/**
 * Publish already-compiled source. This is the path workers take: they receive
 * the JS from the artifact store and never run the compiler themselves.
 */
export function registerCompiledCustomBlock(
	projectId: string,
	name: string,
	source: string,
	id?: string,
) {
	publish(projectId, name, instantiateCompiled(source), id);
}

export function unregisterCustomBlock(projectId: string, name: string) {
	const key = customBlockKey(projectId, name);
	customBlockLibrary.delete(key);
	customBlockIds.delete(key);
}

export function hasCustomBlock(projectId: string, name: string) {
	return customBlockLibrary.has(customBlockKey(projectId, name));
}

/** the names one project has loaded */
export function customBlockNames(projectId: string) {
	const prefix = customBlockKey(projectId, "");
	return [...customBlockLibrary.keys()]
		.filter((key) => key.startsWith(prefix))
		.map((key) => key.slice(prefix.length));
}

function lookup(context: Context, name: string): CompiledCustomBlock {
	const compiled = customBlockLibrary.get(customBlockKey(context.projectId, name));
	if (!compiled) throw new Error(`Custom block not loaded: ${name}`);
	return compiled;
}

/**
 * A nested graph shares the caller's Context, so without this its spans would
 * land flat in the parent trace with nothing saying which block invoked them or
 * which canvas their block ids belong to. `blockId` is the invoking block.
 */
function traced(context: Context, name: string, blockId: string | undefined, detached: boolean) {
	if (!context.trace || !blockId) return { context, close: () => {} };
	const scope = context.trace.enterCustomBlock({
		blockId,
		name,
		detached,
		customBlockId: customBlockIds.get(customBlockKey(context.projectId, name)),
	});
	// a detached invocation records into its own trace, so it needs its own
	// context — mutating the caller's would follow the request back out
	const child = scope.trace === context.trace ? context : { ...context, trace: scope.trace };
	return {
		context: child,
		close: (outcome?: "success" | "failure", error?: unknown) => scope.close(outcome, error),
	};
}

/**
 * How a custom block is called: what it was configured with, and the value
 * flowing into the calling block. They stay apart inside the callee — `params`
 * is its configuration at any depth, `input` is the previous block's output.
 */
export type CustomBlockArgs = { params: Record<string, any>; input?: any };

/**
 * Run a custom block and hand back its whole result rather than its output —
 * a middleware step (#534) needs `responded` and `successful` to decide whether
 * the request goes on. Failures come back as `{ successful: false }`, not thrown.
 */
export async function runCustomBlock(
	context: Context,
	name: string,
	input: unknown,
	blockId: string,
): Promise<BlockOutput> {
	const scope = traced(context, name, blockId, false);
	try {
		return await lookup(context, name)(scope.context, { params: {}, input });
	} catch (error) {
		// only an unloaded block throws here; its graph catches its own failures
		return { successful: false, continueIfFail: false, error: String(error) };
	} finally {
		scope.close();
	}
}

/** sync: wait for the custom block and hand back its output */
export async function invokeCustomBlock(
	context: Context,
	name: string,
	args: CustomBlockArgs,
	blockId?: string,
) {
	const scope = traced(context, name, blockId, false);
	try {
		const result = await lookup(context, name)(scope.context, args);
		// The callee catches its own failures rather than throwing: its graph ends
		// in `$endFailure`, which returns `{ successful: false, error }`. Reading
		// only `output` swallowed that — a throw inside a sync custom block became
		// an undefined value and the route answered 200. `continueIfFail` is the
		// callee's own error handler reporting that it recovered.
		if (result?.successful === false && !result.continueIfFail) {
			throw result.error instanceof Error ? result.error : new Error(String(result.error));
		}
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
	args: CustomBlockArgs,
	blockId?: string,
) {
	const scope = traced(context, name, blockId, true);
	lookup(context, name)(scope.context, args).then(
		() => scope.close("success"),
		(error) => {
			scope.close("failure", error);
			logger.error(`Async custom block '${name}' failed`, "BLOCKS.customBlock", {
				error,
			});
		},
	);
}

/**
 * queued: hand the work to the job queue and move on. Unlike `async` this
 * survives the worker — the job is persisted by the broker and picked up by
 * whichever worker serves this project, so a shutdown mid-flight redelivers
 * instead of losing the work.
 *
 * The job carries the evaluated arguments only: the callee gets a fresh context
 * on the other side, so nothing request-scoped (cookies, headers, `ctx.vars`)
 * crosses. They must therefore be JSON-serializable.
 */
export function enqueueCustomBlock(
	context: Context,
	name: string,
	args: CustomBlockArgs,
	blockId?: string,
) {
	enqueueJob({
		kind: CUSTOM_BLOCK_JOB,
		projectId: context.projectId,
		target: name,
		payload: args,
		origin: { blockId, route: context.route, apiId: context.apiId },
	});
}

export function emitCustomBlock(node: EmitNode) {
	const { blockName, blockDescription, invoke, saveAsVariable, ...params } = (node.block.data ??
		{}) as Record<string, unknown>;
	const mode = customBlockInvokeSchema.parse(invoke);
	const name = JSON.stringify(node.block.type);
	// the callee reads its configuration as `params` and the value flowing into
	// this block as `input` — one meaning each, at every depth of its graph
	const args = `{ params: ${emitJsObject(params, node)}, input: ${node.in} }`;
	const id = JSON.stringify(node.block.id);

	if (mode === "queued") {
		return `lib.enqueue(ctx, ${name}, ${args}, ${id});\n${node.next()}`;
	}
	if (mode === "async") {
		return `lib.invokeAsync(ctx, ${name}, ${args}, ${id});\n${node.next()}`;
	}
	return `${node.in} = await lib.invoke(ctx, ${name}, ${args}, ${id});\n${node.next()}`;
}
