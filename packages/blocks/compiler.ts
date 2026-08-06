import dayjs from "dayjs";
import { BlockTypes } from "./blockTypes";
import type { BlockDTOType, EdgeDTOSchemaType, EdgesType } from "./builderTypes";
import type { BlockOutput, Context } from "./baseBlock";
import { emitArrayOps } from "./builtin/arrayOperations";
import { emitEntrypoint } from "./builtin/entrypoint";
import { emitGetVar } from "./builtin/getVar";
import { emitIf } from "./builtin/if";
import { emitJsRunner } from "./builtin/jsRunner";
import { emitResponse } from "./builtin/response";
import { emitSetVar } from "./builtin/setVar";
import { emitTransformer } from "./builtin/transformer";
import { emitForLoop } from "./builtin/loops/for";
import { emitForEachLoop } from "./builtin/loops/foreach";
import { emitConsoleLog, runConsoleLog } from "./builtin/log/console";
import { emitCloudLogs, runCloudLog } from "./builtin/log/cloudLogs";
import {
	emitCustomBlock,
	hasCustomBlock,
	invokeCustomBlock,
	invokeCustomBlockAsync,
} from "./builtin/customBlock";
import { emitHttpRequest, runHttpRequest } from "./builtin/httpRequest";
import { emitGetHttpHeader } from "./builtin/http/getHttpHeader";
import { emitSetHttpHeader } from "./builtin/http/setHttpHeader";
import { emitGetHttpParam } from "./builtin/http/getHttpParam";
import { emitGetHttpCookie } from "./builtin/http/getHttpCookie";
import { emitSetHttpCookie } from "./builtin/http/setHttpCookie";
import { emitGetHttpRequestBody } from "./builtin/http/getHttpRequestBody";
import { emitGetSingleDb, runGetSingleDb } from "./builtin/db/getSingle";
import { emitGetAllDb, runGetAllDb } from "./builtin/db/getAll";
import { emitInsertDb, runInsertDb } from "./builtin/db/insert";
import { emitInsertBulkDb, runInsertBulkDb } from "./builtin/db/insertBulk";
import { emitUpdateDb, runUpdateDb } from "./builtin/db/update";
import { emitDeleteDb, runDeleteDb } from "./builtin/db/delete";
import { emitNativeDb, runNativeDb } from "./builtin/db/native";
import { emitTransactionDb, runTransactionDb } from "./builtin/db/transaction";
import { hoistImports, type HoistedImport } from "./imports";

/**
 * Everything an emitter needs to turn one block into a JS snippet.
 *
 * The generated scope always has:
 *   ctx     — the execution Context (vm, vars, httpClient, ...)
 *   vars    — alias of ctx.vars
 *   lib     — helpers too big to inline (see `compilerLib`)
 *   node.in — variable holding the value flowing out of the previous block
 */
export type EmitNode = {
	block: BlockDTOType;
	/** variable carrying the previous block's output; also what this block writes */
	in: string;
	/** unique variable name for locals a block needs, e.g. v("i") -> "$i_3" */
	v(prefix: string): string;
	/** code of the block wired to `handle`; a terminal `return` when nothing is */
	next(handle?: string): string;
	/** nested chain (loop bodies): its own flowing variable, falls through at the end */
	body(handle: string, initExpr: string): string;
	/** record this terminal block's output, then return it from its block function */
	complete(output: string): string;
	/** JS expression for a value from block data (`js:` prefixed ones are evaluated) */
	value(raw: unknown): string;
	/**
	 * JS expression running user `code` with `extras` as its `input`.
	 *
	 * Inlined into the compiled function by default. `sync` only matters in
	 * `inlineJs: false` mode, where it picks `vm.run` over `vm.runAsync` to skip
	 * the per-call timeout race — use it wherever the interpreted block used `run`.
	 */
	js(code: string, extras?: string, sync?: boolean): string;
};

export type Emitter = (node: EmitNode) => string;

const emitters: Partial<Record<BlockTypes, Emitter>> = {
	[BlockTypes.entrypoint]: emitEntrypoint,
	[BlockTypes.setvar]: emitSetVar,
	[BlockTypes.getvar]: emitGetVar,
	[BlockTypes.jsrunner]: emitJsRunner,
	[BlockTypes.response]: emitResponse,
	[BlockTypes.if]: emitIf,
	[BlockTypes.forloop]: emitForLoop,
	[BlockTypes.foreachloop]: emitForEachLoop,
	[BlockTypes.transformer]: emitTransformer,
	[BlockTypes.arrayops]: emitArrayOps,
	[BlockTypes.consolelog]: emitConsoleLog,
	[BlockTypes.httprequest]: emitHttpRequest,
	[BlockTypes.httpGetHeader]: emitGetHttpHeader,
	[BlockTypes.httpSetHeader]: emitSetHttpHeader,
	[BlockTypes.httpGetParam]: emitGetHttpParam,
	[BlockTypes.httpGetCookie]: emitGetHttpCookie,
	[BlockTypes.httpSetCookie]: emitSetHttpCookie,
	[BlockTypes.httpGetRequestBody]: emitGetHttpRequestBody,
	[BlockTypes.db_getsingle]: emitGetSingleDb,
	[BlockTypes.db_getall]: emitGetAllDb,
	[BlockTypes.db_insert]: emitInsertDb,
	[BlockTypes.db_insertbulk]: emitInsertBulkDb,
	[BlockTypes.db_update]: emitUpdateDb,
	[BlockTypes.db_delete]: emitDeleteDb,
	[BlockTypes.db_native]: emitNativeDb,
	[BlockTypes.db_transaction]: emitTransactionDb,
	[BlockTypes.cloudLogs]: emitCloudLogs,
};

/** helpers the generated code calls as `lib.x` — anything too big to inline */
export const compilerLib = {
	log: runConsoleLog,
	httpRequest: runHttpRequest,
	isoDate: (value: any) => dayjs(value).toISOString(),
	scope: scopeFor,
	/** Number() with the block's documented fallback for NaN */
	num: (value: any, fallback: number) => {
		const parsed = Number(value);
		return Number.isNaN(parsed) ? fallback : parsed;
	},
	dbGetSingle: runGetSingleDb,
	dbGetAll: runGetAllDb,
	dbInsert: runInsertDb,
	dbInsertBulk: runInsertBulkDb,
	dbUpdate: runUpdateDb,
	dbDelete: runDeleteDb,
	dbNative: runNativeDb,
	dbTransaction: runTransactionDb,
	cloudLog: runCloudLog,
	invoke: invokeCustomBlock,
	invokeAsync: invokeCustomBlockAsync,
};

/**
 * Emits a literal value as JS, turning any `js:` string it contains into
 * inlined code. Used for payloads known at compile time — db insert/update
 * data, custom block parameters.
 */
export function emitJsObject(value: unknown, node: EmitNode): string {
	if (typeof value === "string") return node.value(value);
	if (Array.isArray(value)) {
		return `[${value.map((item) => emitJsObject(item, node)).join(", ")}]`;
	}
	if (value && typeof value === "object") {
		const fields = Object.entries(value).map(
			([key, item]) => `${JSON.stringify(key)}: ${emitJsObject(item, node)}`,
		);
		return `{ ${fields.join(", ")} }`;
	}
	return JSON.stringify(value ?? null);
}

const scopes = new WeakMap<object, any>();

/**
 * What lets inlined user code keep writing bare `abcd` instead of `vars.abcd`:
 * the sandbox handed user code its vars object as the global, so `with (scope)`
 * reproduces that. `has` claims every name so reads resolve here first, falling
 * back to globalThis for Math/JSON/Date; assignments always land in vars, which
 * is how blocks share state. `input` is excluded so it resolves to the wrapper
 * function's parameter instead of leaking into vars, and so are the graph's
 * hoisted import names, which resolve to the module bindings around the block
 * functions.
 */
export function scopeFor(vars: Record<string, any>, skip?: Set<string>) {
	// only the plain case is cached: the skip set belongs to one compiled graph,
	// and a custom block shares the caller's vars with a different set
	if (skip?.size) return makeScope(vars, skip);
	let scope = scopes.get(vars);
	if (!scope) {
		scope = makeScope(vars);
		scopes.set(vars, scope);
	}
	return scope;
}

function makeScope(vars: Record<string, any>, skip?: Set<string>) {
	return new Proxy(vars, {
		has: (target, key: any) => key !== "input" && !skip?.has(key),
		get: (target, key: any) =>
			key === Symbol.unscopables
				? undefined
				: Object.hasOwn(target, key)
					? target[key]
					: (globalThis as any)[key],
		set: (target, key: any, value) => {
			target[key] = value;
			return true;
		},
	});
}

/** mirrors JsVM.truthy / the `is_empty` operator, inlined into every program */
const PRELUDE = `const $truthy = (v) => { const t = typeof v; return t === "bigint" || t === "number" || t === "string" || t === "boolean" ? !!v : (t === "object" && v !== null); };
const $isEmpty = (v) => v === null || v === undefined || v === "" || (typeof v === "object" && Object.keys(v).length === 0);`;

/** marker lets a newer worker load older artifacts during a rolling update */
const COMPILED_ROUTE_FACTORY = "/* fluxify-compiled-route-factory */";

type CompiledRun = (
	ctx: Context,
	input?: unknown,
) => Promise<BlockOutput>;

const AsyncFunction = Object.getPrototypeOf(async function () {})
	.constructor as new (...args: string[]) => (
	ctx: Context,
	input: unknown,
	lib: typeof compilerLib,
) => Promise<BlockOutput>;

const CompiledRouteFactory = Function as unknown as new (
	...args: string[]
) => (lib: typeof compilerLib) => CompiledRun;

/** same handle normalisation BlockBuilder.loadEdges does */
function buildEdgeMap(edges: EdgeDTOSchemaType): EdgesType {
	const map: EdgesType = {};
	for (const edge of edges) {
		let handle = edge.toHandle;
		if (handle.includes("-")) handle = handle.substring(handle.lastIndexOf("-") + 1);
		const outgoing = { to: edge.to, handle };
		if (edge.from in map) map[edge.from].push(outgoing);
		else map[edge.from] = [outgoing];
	}
	return map;
}

export type CompileOptions = {
	/**
	 * Inline user JS into the compiled function instead of calling the sandbox.
	 *
	 * This is the whole point of compiling — the VM realm boundary costs more
	 * than every block in the graph put together. It also removes the sandbox's
	 * 4s script timeout, so a user-written `while (true) {}` blocks the thread
	 * until something outside the process kills it. Set false to keep the VM.
	 */
	inlineJs?: boolean;
	/**
	 * Compile as a custom block: `param:foo` placeholders in block data resolve
	 * against the invocation arguments instead of being baked in.
	 *
	 * The interpreter substitutes them when it builds the graph, which only works
	 * because it rebuilds per caller. A custom block is compiled once for the
	 * whole worker, so the params have to be read from the call — they live in a
	 * function-local, meaning concurrent and nested invocations cannot clobber
	 * each other the way a shared `vars` entry would.
	 */
	asCustomBlock?: boolean;
};

/** turn compiled source back into a runnable graph (worker side, no compiler) */
export function instantiateCompiled(source: string) {
	if (source.startsWith(COMPILED_ROUTE_FACTORY)) {
		const factory = new CompiledRouteFactory("lib", source);
		return factory(compilerLib);
	}

	// Existing artifacts remain executable while workers are rolling over to the
	// factory format. They disappear naturally on the next route compilation.
	const compiled = new AsyncFunction("ctx", "input", "lib", source);
	return (ctx: Context, input?: unknown) => compiled(ctx, input, compilerLib);
}

export function compileGraph(
	blocks: BlockDTOType[],
	edges: EdgeDTOSchemaType,
	{ inlineJs = true, asCustomBlock = false }: CompileOptions = {},
) {
	const byId = new Map(blocks.map((b) => [b.id, b]));
	const edgeMap = buildEdgeMap(edges);
	const entry = blocks.find((b) => b.type === BlockTypes.entrypoint);
	if (!entry) throw new Error("Graph has no entrypoint block");
	const errorHandler = blocks.find((b) => b.type === BlockTypes.errorHandler);

	let counter = 0;
	const blockFunctionNames = new Map<string, string>();
	const reachable = new Set<string>();
	const visiting = new Set<string>();
	const emissionOrder: string[] = [];

	function edgeTo(id: string, handle: string) {
		const outgoing = edgeMap[id]?.filter((edge) => edge.handle === handle) ?? [];
		if (outgoing.length > 1) {
			throw new Error(
				`Block ${id} has ${outgoing.length} outgoing edges on handle ${handle}; multi-edge fan-out is not supported yet`,
			);
		}
		return outgoing[0]?.to;
	}

	function validateEdges() {
		for (const [id, outgoing] of Object.entries(edgeMap)) {
			const countByHandle = new Map<string, number>();
			for (const edge of outgoing) {
				countByHandle.set(edge.handle, (countByHandle.get(edge.handle) ?? 0) + 1);
			}
			for (const [handle, count] of countByHandle) {
				if (count > 1) edgeTo(id, handle);
			}
		}
	}

	function blockFunctionName(id: string) {
		let name = blockFunctionNames.get(id);
		if (!name) {
			name = `$block_${blockFunctionNames.size}`;
			blockFunctionNames.set(id, name);
		}
		return name;
	}

	function collectReachable(id: string | undefined) {
		if (!id || reachable.has(id)) return;
		if (visiting.has(id)) {
			throw new Error(`Cycle through block ${id} is not supported yet`);
		}
		if (!byId.has(id)) throw new Error(`Block not found: ${id}`);

		visiting.add(id);
		emissionOrder.push(id);
		for (const edge of edgeMap[id] ?? []) collectReachable(edge.to);
		visiting.delete(id);
		reachable.add(id);
	}

	/** spec -> local name -> property read off the namespace (null = namespace) */
	const importsBySpec = new Map<string, Map<string, string | null>>();
	/** local name -> the spec that bound it, so a clash is a compile error */
	const importOwners = new Map<string, string>();

	function registerImports(imports: HoistedImport[]) {
		for (const { spec, bindings } of imports) {
			let bound = importsBySpec.get(spec);
			if (!bound) importsBySpec.set(spec, (bound = new Map()));
			for (const { local, imported } of bindings) {
				const owner = importOwners.get(local);
				if (owner && owner !== spec) {
					throw new Error(
						`Import name '${local}' is bound to both "${owner}" and "${spec}"; hoisted imports share one scope across the graph`,
					);
				}
				importOwners.set(local, spec);
				bound.set(local, imported);
			}
		}
	}

	function js(rawCode: string, extras?: string, sync = false) {
		const { code, imports } = hoistImports(rawCode);
		if (imports.length && !inlineJs) {
			throw new Error("import is only supported when user JS is inlined");
		}
		registerImports(imports);
		if (!inlineJs) {
			const method = sync ? "run" : "runAsync";
			return `(await ctx.vm.${method}(${JSON.stringify(code)}${extras ? `, ${extras}` : ""}))`;
		}
		return `(await (async function (input) { with ($scope) {\n${code}\n} })(${extras ?? "undefined"}))`;
	}

	/**
	 * Imports resolve once per compiled artifact — at instantiation, i.e. on
	 * compile and on hot reload — into bindings the block functions close over.
	 * The loads start the moment the factory runs, so they are normally settled
	 * before the first request; after that `$importsReady` is a plain boolean and
	 * a request pays nothing at all, not even a microtask.
	 *
	 * `import(...)` is emitted directly rather than through a `lib` helper: an
	 * artifact outlives the runtime that compiled it, and a worker mid-rollout
	 * would hand this source an older `lib` with no such helper on it.
	 */
	function emitImports() {
		// side-effect-only imports bind nothing but still have to be loaded
		if (!importsBySpec.size) return { declarations: "", ready: "", scopeSkip: "" };
		const names = [...importOwners.keys()];
		const loads = [...importsBySpec].map(([spec, bound], index) => {
			const namespace = `$mod_${index}`;
			const lines = [`const ${namespace} = await import(${JSON.stringify(spec)});`];
			const destructured: string[] = [];
			for (const [local, imported] of bound) {
				if (imported === null) lines.push(`${local} = ${namespace};`);
				// default interop: a CJS module has no `default`, it is the export
				else if (imported === "default")
					lines.push(`${local} = ${namespace}.default ?? ${namespace};`);
				else destructured.push(local === imported ? local : `${imported}: ${local}`);
			}
			if (destructured.length) {
				lines.push(`({ ${destructured.join(", ")} } = ${namespace});`);
			}
			return lines.join("\n");
		});
		return {
			declarations: [
				names.length ? `let ${names.join(", ")};` : "",
				names.length ? `const $importNames = new Set(${JSON.stringify(names)});` : "",
				"let $importsReady = false;",
				`const $imports = (async () => {\n${loads.join(
					"\n",
				)}\n})().then(() => { $importsReady = true; });`,
				// keeps a bad specifier from surfacing as an unhandled rejection; the
				// await below still rejects, so the failure reaches the request
				"$imports.catch(() => {});",
			]
				.filter(Boolean)
				.join("\n"),
			// settled by the time traffic arrives in every normal case, and then this
			// is a boolean test — no await, no microtask on the hot path
			ready: "if (!$importsReady) await $imports;",
			scopeSkip: names.length ? ", $importNames" : "",
		};
	}

	function emitBlock(id: string): string {
		const block = byId.get(id);
		if (!block) throw new Error(`Block not found: ${id}`);
		// anything not built in is a custom block, resolved from the worker-global
		// library it was compiled into rather than being inlined here
		const emitter = hasCustomBlock(block.type)
			? emitCustomBlock
			: emitters[block.type as BlockTypes];
		if (!emitter) throw new Error(`No codegen for block type: ${block.type}`);
		const blockId = JSON.stringify(block.id);
		const blockType = JSON.stringify(block.type);

		function recordSpan(
			output: string,
			error?: string,
			branch?: "success" | "failure",
		) {
			const outcome = error === undefined ? "success" : "failure";
			const branchField = branch ? `, branch: ${JSON.stringify(branch)}` : "";
			const errorField = error === undefined ? "" : `, error: ${error}`;
			const span = `{ blockId: ${blockId}, blockType: ${blockType}, input: $input, output: ${output}, startedAt: $t0, endedAt: performance.now(), outcome: ${JSON.stringify(outcome)}${branchField}${errorField} }`;
			return `$recorded = true;
if ($trace) {
try {
$trace.recordSpan(${span});
} catch {
// Telemetry must never change route execution.
}
}`;
		}

		const code = emitter({
			block,
			in: "$in",
			v: (prefix) => `$${prefix}_${counter++}`,
			next(handle = "source") {
				const to = edgeTo(id, handle);
				const branch =
					block.type === BlockTypes.if &&
					(handle === "success" || handle === "failure")
						? handle
						: undefined;
				const continuation = to
					? `return await ${blockFunctionName(to)}($state, $in, $end);`
					: "return $end($in);";
				return `${recordSpan("$in", undefined, branch)}
${continuation}`;
			},
			body(handle, initExpr) {
				const to = edgeTo(id, handle);
				if (!to) return "";
				const result = `$bodyResult_${counter++}`;
				// mark this block as reported before handing off — an executor's
				// throw must not be misattributed to the loop block that called it
				return `$recorded = true;
const ${result} = await ${blockFunctionName(to)}($state, ${initExpr}, $endBody);
if (${result} !== undefined) return ${result};`;
			},
			complete(output) {
				const result = `$result_${counter++}`;
				return `const ${result} = ${output};
${recordSpan(result)}
return ${result};`;
			},
			value(raw) {
				if (typeof raw !== "string") return JSON.stringify(raw ?? null);
				if (raw.startsWith("js:")) return js(raw.slice(3), "$in");
				if (asCustomBlock && raw.startsWith("param:")) {
					return `$state.params[${JSON.stringify(raw.slice(6))}]`;
				}
				return JSON.stringify(raw);
			},
			js,
		});

		return `// ${block.type} ${id}
async function ${blockFunctionName(id)}($state, $input, $end) {
const { ctx, vars, scope: $scope, trace: $trace } = $state;
const $t0 = $trace ? performance.now() : 0;
let $in = $input;
let $recorded = false;
try {
${code}
} catch ($error) {
if (!$recorded) {
${recordSpan("undefined", "$error")}
}
throw $error;
}
}`;
	}

	// the error handler is unreachable by edges — the engine jumps to it on failure
	const handlerEntry = errorHandler && edgeTo(errorHandler.id, "source");
	validateEdges();
	collectReachable(entry.id);
	collectReachable(handlerEntry);

	for (const id of emissionOrder) blockFunctionName(id);
	const functions = emissionOrder.map(emitBlock).join("\n\n");
	const errorHandlerBody = handlerEntry
		? [
				"const $err = $error?.toString();",
				`return await ${blockFunctionName(handlerEntry)}($state, $err, $endFailure);`,
			].join("\n")
		: "return $endFailure($error);";
	const imports = emitImports();
	const source = [
		COMPILED_ROUTE_FACTORY,
		PRELUDE,
		imports.declarations,
		"const $endSuccess = (output) => ({ successful: true, continueIfFail: true, output });",
		"const $endFailure = (error) => ({ successful: false, continueIfFail: false, error });",
		"const $endBody = () => undefined;",
		functions,
		"",
		"return async function $run(ctx, input) {",
		imports.ready,
		"const vars = ctx.vars;",
		"const $state = {",
		"ctx,",
		"vars,",
		`scope: lib.scope(vars${imports.scopeSkip}),`,
		"trace: ctx.trace,",
		`params: ${asCustomBlock ? "input ?? {}" : "undefined"},`,
		"};",
		"try {",
		`return await ${blockFunctionName(entry.id)}($state, input, $endSuccess);`,
		"} catch ($error) {",
		errorHandlerBody,
		"}",
		"}",
	].join("\n");
	const run = instantiateCompiled(source);
	return {
		source,
		run,
	};
}
