import { type BlockOutput, type Context, outputVariableName } from "./baseBlock";
import { isFanOutHandle, sortByOrder } from "./blockHandles";
import { BlockTypes } from "./blockTypes";
import type { BlockDTOType, EdgeDTOSchemaType, EdgesType } from "./builderTypes";
import { type BlockMetas, handleSpecsOf } from "./builtin/moduleBlock";
import { emitImports } from "./emitImports";
import { emitterFor } from "./emitterFor";
import { type HoistedImport, hoistImports } from "./imports";
import { assertInstalled, type ProjectDependencies } from "./packageImports";
import { pureExpression } from "./pureExpression";
import { compilerLib } from "./registry";
import { scopeFor } from "./scope";
import { blockSpans } from "./spans";
import { emitAfterHook, emitBeforeHook, hookSupport } from "./testHooks";

export { compilerLib, type Emitter } from "./registry";
export { scopeFor } from "./scope";

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
	/**
	 * nested chain (loop bodies): its own flowing variable, falls through at the
	 * end. `end` is called with the chain's last output — the default drops it.
	 */
	body(handle: string, initExpr: string, end?: string): string;
	/** whether an edge leaves this block on `handle` */
	has(handle: string): boolean;
	/** every edge leaving block `from` (default: this one), error handler excluded */
	edgesFrom(from?: string): { handle: string; to: BlockDTOType }[];
	/** expression running the chain that starts at block `to` from `initExpr`, ending in `end` */
	call(to: string, initExpr: string, end: string): string;
	/**
	 * Expression running every chain on a fan-out handle at once, each from this
	 * block's input, ordered by `order`. Resolves to the outputs array, or to a
	 * terminal result when a chain ends the route first.
	 */
	parallel(handle: string, order: string[], settle: boolean): string;
	/** one continuation per edge on a fan-out handle, ordered by `order`, for the caller to guard (switch) */
	cases(handle: string, order: string[]): { to: string; run: string }[];
	/** record this terminal block's output, then return it from its block function */
	complete(output: string): string;
	/** declare `expr` once per compiled artifact, evaluated when it is instantiated; returns the variable holding it */
	hoist(expr: string): string;
	/** JS expression for a value from block data (`js:` prefixed ones are evaluated) */
	value(raw: unknown): string;
	/** JS expression running user `code` with `extras` as its `input`, inlined into the compiled function */
	js(code: string, extras?: string): string;
	/** this graph can be stopped mid-run: `ctx.signal` aborting ends it (workflows, #1034) */
	stoppable: boolean;
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

/** mirrors JsVM.truthy / the `is_empty` operator, inlined into every program */
const PRELUDE = `const $truthy = (v) => { const t = typeof v; return t === "bigint" || t === "number" || t === "string" || t === "boolean" ? !!v : (t === "object" && v !== null); };
const $isEmpty = (v) => v === null || v === undefined || v === "" || (typeof v === "object" && Object.keys(v).length === 0);
const $blockKey = Symbol.for("fluxify.block");
const $tagBlock = (e, block) => { if (e !== null && typeof e === "object" && !Object.hasOwn(e, $blockKey)) try { Object.defineProperty(e, $blockKey, { value: block }); } catch {} };
const $branchEnd = Symbol("branch");
const $endBranch = (output) => ({ [$branchEnd]: output });
const $parallel = (runs, settle) => new Promise((resolve, reject) => {
const out = new Array(runs.length);
let left = runs.length;
if (!left) return resolve(out);
const done = (i, value) => { out[i] = value; if (--left === 0) resolve(out); };
runs.forEach((run, i) => run.then(
(r) => (r && $branchEnd in r ? done(i, r[$branchEnd]) : resolve(r)),
(error) => (settle ? done(i, error?.toString()) : reject(error)),
));
});`;

/** marker lets a newer worker load older artifacts during a rolling update */
const COMPILED_ROUTE_FACTORY = "/* fluxify-compiled-route-factory */";

type CompiledRun = (ctx: Context, input?: unknown) => Promise<BlockOutput>;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
	...args: string[]
) => (ctx: Context, input: unknown, lib: typeof compilerLib) => Promise<BlockOutput>;

const CompiledRouteFactory = Function as unknown as new (
	...args: string[]
) => (lib: typeof compilerLib) => CompiledRun;

/** normalizes edge handles the same way for every consumer of the graph DTOs */
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
	 * The project the graph belongs to. A block type that is not built in is a
	 * custom block only if this project has one by that name; unset, none is.
	 */
	projectId?: string;
	/**
	 * The project's npm packages (#477). When set, a package import must be one
	 * of them, and it resolves from the project's deps directory. Unset keeps the
	 * old behaviour — plain `import(spec)` — for callers with no project.
	 */
	dependencies?: ProjectDependencies;
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
	/**
	 * Compile as a workflow: a response block becomes a plain terminal.
	 *
	 * A workflow runs in the background off a queue. There is no connection held
	 * open and nobody to receive a status code, so emitting the HTTP-shaped
	 * result a route's response block produces would only put a `httpCode` into
	 * a value nothing reads. The block still ends the run — that is what a
	 * terminal does — it just stops dressing the output up as a reply.
	 */
	asWorkflow?: boolean;
	/**
	 * Test compile only (#483): each block checks `ctx.testHooks[blockId]` for a
	 * suite's `before(input)` / `after(input, output)` hooks. `before` resolves to
	 * nothing, `{ input }` to replace the input, or `{ skip: true, output, branch? }`
	 * to not run the block and send `output` down `branch`. `after` resolves to
	 * the output to pass on. Live compiles never set it, so live code has no hook
	 * checks at all.
	 */
	hooks?: boolean;
	/**
	 * Emit span recording (#576). Off for a route or workflow with tracing
	 * disabled: nothing would ever read the spans, so the timer, the try/catch
	 * and the `$trace` checks are only dead weight in the artifact. Custom blocks
	 * and test compiles keep the default — a custom block is shared by traced and
	 * untraced callers, and test runs are where per-block recording will land.
	 */
	tracing?: boolean;
	/**
	 * Programmable blocks by type (plugin manifests): their handles and invoke
	 * modes. The one source for both, since admin compiles without plugin code.
	 */
	blockMeta?: BlockMetas;
};

/**
 * Names the graph's stack frames, so an error from user code can show its own
 * frames without the server's file paths (#671).
 */
export const GRAPH_SOURCE_URL = "fluxify-graph";
const SOURCE_URL = `\n//# sourceURL=${GRAPH_SOURCE_URL}`;

/** turn compiled source back into a runnable graph (worker side, no compiler) */
export function instantiateCompiled(source: string) {
	if (source.startsWith(COMPILED_ROUTE_FACTORY)) {
		const factory = new CompiledRouteFactory("lib", source + SOURCE_URL);
		return factory(compilerLib);
	}

	// Existing artifacts remain executable while workers are rolling over to the
	// factory format. They disappear naturally on the next route compilation.
	const compiled = new AsyncFunction("ctx", "input", "lib", source + SOURCE_URL);
	return (ctx: Context, input?: unknown) => compiled(ctx, input, compilerLib);
}

export function compileGraph(
	blocks: BlockDTOType[],
	edges: EdgeDTOSchemaType,
	{
		asCustomBlock = false,
		asWorkflow = false,
		dependencies,
		blockMeta = {},
		hooks = false,
		projectId,
		tracing = true,
	}: CompileOptions = {},
) {
	const handleSpecs = handleSpecsOf(blockMeta);
	const byId = new Map(blocks.map((b) => [b.id, b]));
	const edgeMap = buildEdgeMap(edges);
	const entry = blocks.find((b) => b.type === BlockTypes.entrypoint);
	if (!entry) throw new Error("Graph has no entrypoint block");
	const errorHandler = blocks.find((b) => b.type === BlockTypes.errorHandler);
	// custom blocks are shared with routes, so only a workflow's own graph has checks
	const stoppable = asWorkflow && !asCustomBlock;

	let counter = 0;
	const hoisted: string[] = [];
	const blockFunctionNames = new Map<string, string>();
	const reachable = new Set<string>();
	const visiting = new Set<string>();
	const emissionOrder: string[] = [];
	/** blocks a caller runs as a promise (`call`, `parallel`): never emitted as plain functions */
	const promised = new Set<string>();

	/**
	 * The error handler is entered by jump, never by an edge: it is compiled from
	 * its own `source` chain into `errorHandlerBody`, so `emitters` deliberately
	 * has no entry for it, and the editor gives it no inbound socket. An edge
	 * pointing at it is a stale row or an agent's invention, so this and
	 * `collectReachable` both ignore one — that costs a connection which could
	 * never have run, where throwing costs the whole route and (via
	 * `ensureCustomBlocksRegistered`) every other route in the project.
	 */
	function edgeTo(id: string, handle: string) {
		const outgoing = edgeMap[id]?.filter((edge) => edge.handle === handle) ?? [];
		if (outgoing.length > 1) {
			throw new Error(
				`Block ${id} has ${outgoing.length} outgoing edges on handle ${handle}; multi-edge fan-out is not supported yet`,
			);
		}
		const to = outgoing[0]?.to;
		return byId.get(to ?? "")?.type === BlockTypes.errorHandler ? undefined : to;
	}

	/** targets of every edge on a fan-out handle, sorted by the block's stored `order` */
	function fanOutTargets(id: string, handle: string, order: string[]) {
		const outgoing = (edgeMap[id] ?? []).filter(
			(edge) => edge.handle === handle && byId.get(edge.to)?.type !== BlockTypes.errorHandler,
		);
		return sortByOrder(outgoing, order, (edge) => edge.to).map((edge) => edge.to);
	}

	function validateEdges() {
		for (const [id, outgoing] of Object.entries(edgeMap)) {
			const countByHandle = new Map<string, number>();
			for (const edge of outgoing) {
				countByHandle.set(edge.handle, (countByHandle.get(edge.handle) ?? 0) + 1);
			}
			for (const [handle, count] of countByHandle) {
				const spec = handleSpecs[byId.get(id)?.type ?? ""];
				if (count > 1 && !isFanOutHandle(handle, spec)) edgeTo(id, handle);
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
		for (const edge of edgeMap[id] ?? []) {
			if (byId.get(edge.to)?.type !== BlockTypes.errorHandler) collectReachable(edge.to);
		}
		visiting.delete(id);
		reachable.add(id);
	}

	/** spec -> local name -> property read off the namespace (null = namespace) */
	const importsBySpec = new Map<string, Map<string, string | null>>();
	/** local name -> the spec that bound it, so a clash is a compile error */
	const importOwners = new Map<string, string>();

	function registerImports(imports: HoistedImport[]) {
		for (const { spec, bindings } of imports) {
			assertInstalled(spec, dependencies);
			let bound = importsBySpec.get(spec);
			if (!bound) {
				bound = new Map();
				importsBySpec.set(spec, bound);
			}
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

	function js(rawCode: string, extras?: string) {
		// a code field is already JS: a leading `js:` would parse as a label, and
		// `js: const x` is then a syntax error. Validation warns about it.
		const { code, imports } = hoistImports(rawCode.replace(/^\s*js:/, ""));
		registerImports(imports);
		// a lone pure expression runs inline: no function, scope proxy or promise per call (#944)
		const pure = imports.length
			? undefined
			: pureExpression(code, { input: extras ?? "undefined", params: "$state.params" });
		if (pure) return pure;
		// `params` is the custom block's invocation arguments — undefined in a
		// route graph, so `input` keeps meaning exactly one thing everywhere: the
		// previous block's output.
		return `(await (async function (input, params) { with ($scope) {\n${code}\n} })(${extras ?? "undefined"}, $state.params))`;
	}

	function emitBlock(id: string): string {
		const block = byId.get(id);
		if (!block) throw new Error(`Block not found: ${id}`);
		const emitter = emitterFor(block, { metas: blockMeta, projectId, asWorkflow });
		if (!emitter) throw new Error(`No codegen for block type: ${block.type}`);
		const blockId = JSON.stringify(block.id);
		const support = hooks ? hookSupport(block.type) : "none";
		const entry = !asCustomBlock && block.type === BlockTypes.entrypoint;
		const spans = blockSpans(block, tracing, support !== "none", entry);
		const afterHook = (target: string) => emitAfterHook(support, target);

		const continueTo = (handle: string, runAfter: boolean) => {
			const to = edgeTo(id, handle);
			const branching =
				block.type === BlockTypes.if ||
				block.type === BlockTypes.db_exists ||
				block.type === BlockTypes.db_transaction ||
				block.type === BlockTypes.retry ||
				block.type === BlockTypes.queue_send ||
				handleSpecs[block.type]?.out.length === 2;
			const branch =
				branching && (handle === "success" || handle === "failure") ? handle : undefined;
			// a tail call: the callee rejects on its own, and its block is the one that tags the error
			const continuation = to
				? `return ${blockFunctionName(to)}($state, $in, $end);`
				: "return $end($in);";
			// Row Exists saves the row on success and clears it on failure, so a
			// loop's later miss never leaves an earlier iteration's row behind.
			// Send Message saves what it reports on either branch.
			const saved =
				block.type === BlockTypes.queue_send && branch
					? "$in"
					: handle === "source" ||
							((block.type === BlockTypes.db_transaction || block.type === BlockTypes.retry) &&
								handle === "success") ||
							(block.type === BlockTypes.db_exists && branch)
						? handle === "failure"
							? "null"
							: "$in"
						: undefined;
			const saveAs = saved && outputVariableName(block.data);
			// vars is per request, so outputs never leak into the next one
			const save = saveAs ? `(vars.outputs ??= {})[${JSON.stringify(saveAs)}] = ${saved};\n` : "";
			return `${runAfter ? afterHook("$in") : ""}${save}${spans.record("$in", undefined, branch)}
${continuation}`;
		};

		const code = emitter({
			block,
			in: "$in",
			v: (prefix) => `$${prefix}_${counter++}`,
			next(handle = "source") {
				return continueTo(handle, true);
			},
			body(handle, initExpr, end = "$endBody") {
				const to = edgeTo(id, handle);
				if (!to) return "";
				const result = `$bodyResult_${counter++}`;
				// mark this block as reported before handing off — an executor's
				// throw must not be misattributed to the loop block that called it
				return `${spans.handOff && `${spans.handOff};\n`}const ${result} = await ${blockFunctionName(to)}($state, ${initExpr}, ${end});
if (${result} !== undefined) return ${result};`;
			},
			has(handle) {
				return edgeTo(id, handle) !== undefined;
			},
			edgesFrom(from = id) {
				return (edgeMap[from] ?? []).flatMap(({ handle, to }) => {
					const target = byId.get(to);
					return target && target.type !== BlockTypes.errorHandler ? [{ handle, to: target }] : [];
				});
			},
			call: (to, initExpr, end) => {
				promised.add(to);
				return `${blockFunctionName(to)}($state, ${initExpr}, ${end})`;
			},
			parallel(handle, order, settle) {
				const runs = fanOutTargets(id, handle, order).map((to) => {
					promised.add(to);
					return `${blockFunctionName(to)}($state, $in, $endBranch)`;
				});
				// reported before handing off, like body(): a branch's throw is its own
				return `(${spans.handOff && `${spans.handOff}, `}await $parallel([${runs.join(", ")}], ${settle}))`;
			},
			cases(handle, order) {
				return fanOutTargets(id, handle, order).map((to) => ({
					to,
					run: `${spans.record("$in", undefined, undefined, to)}\nreturn ${blockFunctionName(to)}($state, $in, $end);`,
				}));
			},
			complete(output) {
				const result = `$result_${counter++}`;
				return `let ${result} = ${output};
${afterHook(result)}${spans.record(result)}
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
			stoppable,
			hoist(expr) {
				const name = `$h_${counter++}`;
				hoisted.push(`const ${name} = ${expr};`);
				return name;
			},
		});

		return `// ${block.type} ${id}
async function ${blockFunctionName(id)}($state, $input, $end) {
${stoppable ? "$state.ctx.signal?.throwIfAborted();\n" : ""}${spans.wrap(`${emitBeforeHook(block.type, blockId, support, (h) => continueTo(h, false), handleSpecs[block.type])}${code}`)}
}`;
	}

	// the error handler is unreachable by edges — the engine jumps to it on failure
	const handlerEntry = errorHandler && edgeTo(errorHandler.id, "source");
	validateEdges();
	collectReachable(entry.id);
	collectReachable(handlerEntry);

	for (const id of emissionOrder) blockFunctionName(id);
	const emitted = emissionOrder.map((id) => [id, emitBlock(id)] as const);
	// a block left with nothing to wait on is a plain function: no promise or microtask per hop.
	// A stray `await` in a string only keeps one async, never the reverse.
	const functions = emitted
		.map(([id, code]) =>
			promised.has(id) || /\bawait\b/.test(code)
				? code
				: code.replace(
						`async function ${blockFunctionName(id)}(`,
						`function ${blockFunctionName(id)}(`,
					),
		)
		.join("\n\n");
	const errorHandlerBody = handlerEntry
		? [
				"const $err = $error?.toString();",
				`return await ${blockFunctionName(handlerEntry)}($state, $err, $endFailure);`,
			].join("\n")
		: "return $endFailure($error);";
	const imports = emitImports(importsBySpec, importOwners, dependencies);
	const source = [
		COMPILED_ROUTE_FACTORY,
		PRELUDE,
		imports.declarations,
		...hoisted,
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
		// only user code still run in `with` reads it; a fully inlined graph skips the proxy
		functions.includes("with ($scope)")
			? `scope: lib.scope(vars${imports.scopeSkip}),`
			: "scope: undefined,",
		"trace: ctx.trace,",
		...(hooks ? ["hooks: ctx.testHooks,"] : []),
		// a custom block is called with { params, input }: its configuration and
		// the caller's flowing value, kept apart all the way down the graph
		`params: ${asCustomBlock ? "input?.params ?? {}" : "undefined"},`,
		"};",
		// the outermost graph on this context owns the run's lifetime (#850)
		"const $life = ctx.lifetime?.ended === false ? undefined : (ctx.lifetime = { ended: false });",
		"try {",
		`return await ${blockFunctionName(entry.id)}($state, ${asCustomBlock ? "input?.input" : "input"}, $endSuccess);`,
		"} catch ($error) {",
		...(stoppable ? ["if (ctx.signal?.aborted) return $endFailure($error);"] : []),
		errorHandlerBody,
		"} finally {",
		"if ($life) $life.ended = true;",
		"}",
		"}",
	].join("\n");
	const run = instantiateCompiled(source);
	// the programmable block types this graph calls: a worker imports them before it loads the artifact
	const pluginBlocks = [
		...new Set(emissionOrder.map((id) => byId.get(id)!.type).filter((type) => blockMeta[type])),
	];
	return {
		source,
		run,
		pluginBlocks,
	};
}
