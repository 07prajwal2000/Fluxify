import { BlockTypes } from "./blockTypes";
import type { BlockDTOType, EdgeDTOSchemaType, EdgesType } from "./builderTypes";
import type { BlockOutput, Context } from "./baseBlock";
import { emitCustomBlock, hasCustomBlock } from "./builtin/customBlock";
import { emitWorkflowEnd } from "./builtin/response";
import { compilerLib, emitters } from "./registry";
import { scopeFor } from "./scope";
import { hoistImports, type HoistedImport } from "./imports";

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
	{ inlineJs = true, asCustomBlock = false, asWorkflow = false }: CompileOptions = {},
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
		// `params` is the custom block's invocation arguments — undefined in a
		// route graph, so `input` keeps meaning exactly one thing everywhere: the
		// previous block's output.
		return `(await (async function (input, params) { with ($scope) {\n${code}\n} })(${extras ?? "undefined"}, $state.params))`;
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
			: asWorkflow && block.type === BlockTypes.response
				? emitWorkflowEnd
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
		// a custom block is called with { params, input }: its configuration and
		// the caller's flowing value, kept apart all the way down the graph
		`params: ${asCustomBlock ? "input?.params ?? {}" : "undefined"},`,
		"};",
		"try {",
		`return await ${blockFunctionName(entry.id)}($state, ${asCustomBlock ? "input?.input" : "input"}, $endSuccess);`,
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
