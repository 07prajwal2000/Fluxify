import { logger } from "@fluxify/common";
import { BLOCK_DATA_KEYS, INVOKE_MODES, MODULE_BLOCK_DATA_KEYS } from "@fluxify/sdk";
import z from "zod";
import type { BlockOutput, Context } from "../baseBlock";
import { type HandleSpec, handleSpecSchema } from "../blockHandles";
import type { BlockDTOType, EdgeDTOSchemaType } from "../builderTypes";
import { compileGraph, type EmitNode, emitJsObject, instantiateCompiled } from "../compiler";
import { enqueueJob } from "../jobs";
import { compileSchema } from "../schema/schemaCache";
import { withCtxPool } from "./ctxPool";
import { withCtxSpan } from "./ctxSpan";
import { withCtxSse } from "./ctxSse";
import type { ExecuteHandle } from "./executeHandle";
import { emitFieldMap } from "./transformer";

export const customBlockInvokeSchema = z
	.enum(INVOKE_MODES)
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
const customBlockLibrary = new Map<string, BlockEntry>();
/** resource id -> library key, so a rename or delete can find what the id was registered as */
const keysById = new Map<string, string>();

/**
 * One library entry. `source` says how `run` was produced: a compiled canvas,
 * or a plain JS module (programmable blocks). It is not the stored block's
 * `sourceType` (user-defined / inhouse / plugin), which says where the row came
 * from — an inhouse block is still a canvas. `meta` is stored for the handle
 * router and the compile-time invoke check; nothing reads it yet.
 */
export type BlockEntry = {
	run: CompiledCustomBlock;
	/** the resource id (canvas custom block id, later the plugin id); a trace names it */
	id?: string;
	source: "canvas" | "module";
	meta?: BlockMeta;
};

export type BlockMeta = {
	handles?: HandleSpec;
	invoke?: z.infer<typeof customBlockInvokeSchema>[];
	/** param names of type `schema`: `run` gets each as `{ zod, schema }` (R7), not the raw definition */
	schemaParams?: string[];
	/** param names of type `fieldMap`: `run` gets each applied to the block's input, as a Transformer maps */
	fieldMapParams?: string[];
};

const customBlockKey = (projectId: string, type: string) => `${projectId}:${type}`;

/**
 * Publish a block under `type`. An entry with an id replaces whatever that id
 * was registered as before, so a rename never leaves the old type resolving.
 */
export function registerBlock(projectId: string, type: string, entry: BlockEntry) {
	const key = customBlockKey(projectId, type);
	const previous = entry.id && keysById.get(entry.id);
	if (previous && previous !== key) customBlockLibrary.delete(previous);
	unregisterBlock(projectId, type);
	customBlockLibrary.set(key, entry);
	if (entry.id) keysById.set(entry.id, key);
}

export function unregisterBlock(projectId: string, type: string) {
	const key = customBlockKey(projectId, type);
	const id = customBlockLibrary.get(key)?.id;
	if (id && keysById.get(id) === key) keysById.delete(id);
	customBlockLibrary.delete(key);
}

/** drop whatever `id` is registered as; ids are unique across projects */
export function unregisterById(id: string) {
	const key = keysById.get(id);
	if (key) customBlockLibrary.delete(key);
	keysById.delete(id);
}

export function getBlockEntry(projectId: string, type: string) {
	return customBlockLibrary.get(customBlockKey(projectId, type));
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
	registerBlock(projectId, name, { run, id, source: "canvas" });
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
	registerBlock(projectId, name, { run: instantiateCompiled(source), id, source: "canvas" });
}

/** What a module block's `run` returns: its output, and the handle to leave by (routed in R3). */
export type ModuleBlockResult = { output?: unknown; handle?: string };

/**
 * Hand a block its `schema` params as `{ zod, schema }`. Emitted code already
 * did that for a sync call; an async or queued call carries the plain
 * definition (a job payload is JSON), so it is converted here, through the same
 * cache, which also covers a block run by hand.
 */
function withSchemas(params: Record<string, any>, names: string[] = []) {
	if (!names.length) return params;
	const out = { ...params };
	for (const name of names) {
		const value = out[name];
		if (value && typeof value === "object" && !("zod" in value)) out[name] = compileSchema(value);
	}
	return out;
}
export type ModuleBlockRun = (args: {
	params: Record<string, any>;
	input?: any;
	ctx: Context;
	/** runs a body handle's chain; a block without body handles gets one that throws */
	executeHandle?: ExecuteHandle;
}) => ModuleBlockResult | Promise<ModuleBlockResult>;

/**
 * Publish a plain JS function as a block. A throw comes back as
 * `{ successful: false, error }`, the way a canvas block's `$endFailure`
 * reports, so every invoke mode handles both sources the same.
 */
export function registerModuleBlock(
	projectId: string,
	type: string,
	run: ModuleBlockRun,
	meta?: BlockMeta,
	id?: string,
) {
	// a bad manifest fails here, at register, not when a canvas first routes on it
	if (meta?.handles)
		meta = { ...meta, handles: handleSpecSchema.parse(meta.handles) as HandleSpec };
	const wrapped: CompiledCustomBlock = async (ctx, args?: CustomBlockArgs) => {
		const pooled = withCtxPool(withCtxSse(withCtxSpan(ctx)), type);
		try {
			const result = await run({
				params: withSchemas(args?.params ?? {}, meta?.schemaParams),
				input: args?.input,
				ctx: pooled.ctx,
				executeHandle: args?.executeHandle,
			});
			return {
				successful: true,
				continueIfFail: false,
				output: result?.output,
				handle: result?.handle,
			};
		} catch (error) {
			return { successful: false, continueIfFail: false, error };
		} finally {
			pooled.release();
		}
	};
	registerBlock(projectId, type, { run: wrapped, id, source: "module", meta });
}

export const unregisterCustomBlock = unregisterBlock;

export function hasCustomBlock(projectId: string, name: string) {
	return customBlockLibrary.has(customBlockKey(projectId, name));
}

/** every block loaded in this worker, across projects */
export const customBlockCount = () => customBlockLibrary.size;

/** the names one project has loaded */
export function customBlockNames(projectId: string) {
	const prefix = customBlockKey(projectId, "");
	return [...customBlockLibrary.keys()]
		.filter((key) => key.startsWith(prefix))
		.map((key) => key.slice(prefix.length));
}

export function lookupBlock(context: Context, name: string): CompiledCustomBlock {
	const entry = getBlockEntry(context.projectId, name);
	if (!entry) throw new Error(`Custom block not loaded: ${name}`);
	return entry.run;
}

/**
 * A nested graph shares the caller's Context, so without this its spans would
 * land flat in the parent trace with nothing saying which block invoked them or
 * which canvas their block ids belong to. `blockId` is the invoking block.
 */
export function tracedBlock(
	context: Context,
	name: string,
	blockId: string | undefined,
	detached: boolean,
) {
	if (!context.trace || !blockId) return { context, close: () => {} };
	const scope = context.trace.enterCustomBlock({
		blockId,
		name,
		detached,
		customBlockId: getBlockEntry(context.projectId, name)?.id,
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
export type CustomBlockArgs = {
	params: Record<string, any>;
	input?: any;
	/** sync programmable blocks only: never serialized, a queued job has no run to call back into */
	executeHandle?: ExecuteHandle;
};

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
	const scope = tracedBlock(context, name, blockId, false);
	try {
		return await lookupBlock(context, name)(scope.context, { params: {}, input });
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
	const scope = tracedBlock(context, name, blockId, false);
	try {
		const result = await lookupBlock(context, name)(scope.context, args);
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
	const scope = tracedBlock(context, name, blockId, true);
	lookupBlock(context, name)(scope.context, args)
		.then((result) => {
			// a block reports failure as a result, not a rejection (see invokeCustomBlock)
			if (result?.successful === false && !result.continueIfFail) throw result.error;
			scope.close("success");
		})
		.catch((error) => {
			scope.close("failure", error);
			logger.error(`Async custom block '${name}' failed`, "BLOCKS.customBlock", {
				error,
			});
		});
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

// owned by the SDK, which rejects a plugin param by one of these names
export { MODULE_BLOCK_DATA_KEYS };

/** the pieces of a call to a library block: mode, then `(ctx, name, args, id)` */
/**
 * A `schema` param as `{ zod, schema }`. A stored definition is compiled when
 * the artifact is instantiated (hoisted, so every request shares it); a `js:`
 * expression is only known per request, so it compiles then, through the same
 * cache.
 */
function emitSchemaParam(value: unknown, node: EmitNode, name: string) {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		// fail the compile, naming the block, rather than the first request
		try {
			compileSchema(value);
		} catch (error) {
			throw new Error(
				`Block ${node.block.id} (${node.block.type}) param '${name}': ${(error as Error).message}`,
			);
		}
		return node.hoist(`lib.compileSchema(${JSON.stringify(value)})`);
	}
	if (typeof value === "string" && value.startsWith("js:"))
		return `lib.compileSchema(${node.value(value)})`;
	if (value == null) return "null";
	throw new Error(
		`Block ${node.block.id} (${node.block.type}) param '${name}' must be a schema definition or a js: expression`,
	);
}

/** a field map param: an object maps the input as a Transformer would; anything else goes on for the block to refuse */
const emitFieldMapParam = (value: unknown, node: EmitNode) =>
	value && typeof value === "object" && !Array.isArray(value)
		? emitFieldMap(value as Record<string, unknown>, node.in)
		: emitJsObject(value, node);

/** the params a call emits specially, by name: a module block's manifest says which */
export type SpecialParams = Pick<BlockMeta, "schemaParams" | "fieldMapParams">;

export function emitBlockCall(
	node: EmitNode,
	reserved: readonly string[] = BLOCK_DATA_KEYS,
	{ schemaParams = [], fieldMapParams = [] }: SpecialParams = {},
) {
	const data = (node.block.data ?? {}) as Record<string, unknown>;
	const params = Object.fromEntries(
		Object.entries(data).filter(([key]) => !reserved.includes(key)),
	);
	const emit = (key: string, item: unknown) =>
		schemaParams.includes(key)
			? emitSchemaParam(item, node, key)
			: fieldMapParams.includes(key)
				? emitFieldMapParam(item, node)
				: emitJsObject(item, node);
	// the callee reads its configuration as `params` and the value flowing into
	// this block as `input` — one meaning each, at every depth of its graph
	const fields = Object.entries(params).map(
		([key, item]) => `${JSON.stringify(key)}: ${emit(key, item)}`,
	);
	const args = `{ params: { ${fields.join(", ")} }, input: ${node.in} }`;
	const call = `(ctx, ${JSON.stringify(node.block.type)}, ${args}, ${JSON.stringify(node.block.id)})`;
	return { mode: customBlockInvokeSchema.parse(data.invoke), call };
}

export function emitCustomBlock(
	node: EmitNode,
	reserved?: readonly string[],
	special?: SpecialParams,
) {
	const { mode, call } = emitBlockCall(node, reserved, special);

	if (mode === "queued") {
		return `lib.enqueue${call};\n${node.next()}`;
	}
	if (mode === "async") {
		return `lib.invokeAsync${call};\n${node.next()}`;
	}
	return `${node.in} = await lib.invoke${call};\n${node.next()}`;
}
