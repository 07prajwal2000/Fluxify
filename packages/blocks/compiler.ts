import dayjs from "dayjs";
import { BlockTypes } from "./blockTypes";
import type { BlockDTOType, EdgeDTOSchemaType, EdgesType } from "./builderTypes";
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
 * function's parameter instead of leaking into vars.
 */
export function scopeFor(vars: Record<string, any>) {
	let scope = scopes.get(vars);
	if (!scope) {
		scope = new Proxy(vars, {
			has: (target, key) => key !== "input",
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
		scopes.set(vars, scope);
	}
	return scope;
}

/** mirrors JsVM.truthy / the `is_empty` operator, inlined into every program */
const PRELUDE = `const vars = ctx.vars;
const $truthy = (v) => { const t = typeof v; return t === "bigint" || t === "number" || t === "string" || t === "boolean" ? !!v : (t === "object" && v !== null); };
const $isEmpty = (v) => v === null || v === undefined || v === "" || (typeof v === "object" && Object.keys(v).length === 0);
const $scope = lib.scope(vars);`;

const AsyncFunction = Object.getPrototypeOf(async function () {})
	.constructor as new (...args: string[]) => (
	ctx: any,
	input: any,
	lib: typeof compilerLib,
) => Promise<any>;

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
	const compiled = new AsyncFunction("ctx", "input", "lib", source);
	return (ctx: any, input?: any) => compiled(ctx, input, compilerLib);
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
	// ponytail: a path set only rejects cycles, and a diamond re-emits its shared
	// tail once per branch. Emit-shared-blocks-as-functions when a real graph hurts.
	const path = new Set<string>();

	function edgeTo(id: string, handle: string) {
		return edgeMap[id]?.find((e) => e.handle === handle)?.to;
	}

	function js(code: string, extras?: string, sync = false) {
		if (!inlineJs) {
			const method = sync ? "run" : "runAsync";
			return `(await ctx.vm.${method}(${JSON.stringify(code)}${extras ? `, ${extras}` : ""}))`;
		}
		return `(await (async function (input) { with ($scope) {\n${code}\n} })(${extras ?? "undefined"}))`;
	}

	function emit(id: string, inVar: string, tail: string): string {
		const block = byId.get(id);
		if (!block) throw new Error(`Block not found: ${id}`);
		// anything not built in is a custom block, resolved from the worker-global
		// library it was compiled into rather than being inlined here
		const emitter = hasCustomBlock(block.type)
			? emitCustomBlock
			: emitters[block.type as BlockTypes];
		if (!emitter) throw new Error(`No codegen for block type: ${block.type}`);
		if (path.has(id)) throw new Error(`Cycle through block ${id} is not supported yet`);
		path.add(id);

		const code = emitter({
			block,
			in: inVar,
			v: (prefix) => `$${prefix}_${counter++}`,
			next(handle = "source") {
				const to = edgeTo(id, handle);
				return to ? emit(to, inVar, tail) : tail;
			},
			body(handle, initExpr) {
				const to = edgeTo(id, handle);
				if (!to) return "";
				const scoped = `$b_${counter++}`;
				return `let ${scoped} = ${initExpr};\n${emit(to, scoped, "")}`;
			},
			value(raw) {
				if (typeof raw !== "string") return JSON.stringify(raw ?? null);
				if (raw.startsWith("js:")) return js(raw.slice(3), inVar);
				if (asCustomBlock && raw.startsWith("param:")) {
					return `$params[${JSON.stringify(raw.slice(6))}]`;
				}
				return JSON.stringify(raw);
			},
			js,
		});

		path.delete(id);
		return `// ${block.type} ${id}\n${code}`;
	}

	const IN = "$in";
	const done = `return { successful: true, continueIfFail: true, output: ${IN} };`;
	const main = `let ${IN} = input;\n${emit(entry.id, IN, done)}`;

	// the error handler is unreachable by edges — the engine jumps to it on failure
	const handlerEntry = errorHandler && edgeTo(errorHandler.id, "source");
	const body = handlerEntry
		? `try {
${main}
} catch ($e) {
let $err = $e?.toString();
${emit(handlerEntry, "$err", `return { successful: false, continueIfFail: false, error: $err };`)}
}`
		: `try {
${main}
} catch ($e) {
return { successful: false, continueIfFail: false, error: $e };
}`;

	const params = asCustomBlock ? "const $params = input ?? {};\n" : "";
	const source = `${PRELUDE}\n${params}${body}`;
	const compiled = new AsyncFunction("ctx", "input", "lib", source);
	return {
		source,
		run: (ctx: any, input?: any) => compiled(ctx, input, compilerLib),
	};
}
