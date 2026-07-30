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
import { emitHttpRequest, runHttpRequest } from "./builtin/httpRequest";
import { emitGetHttpHeader } from "./builtin/http/getHttpHeader";
import { emitSetHttpHeader } from "./builtin/http/setHttpHeader";
import { emitGetHttpParam } from "./builtin/http/getHttpParam";
import { emitGetHttpCookie } from "./builtin/http/getHttpCookie";
import { emitSetHttpCookie } from "./builtin/http/setHttpCookie";
import { emitGetHttpRequestBody } from "./builtin/http/getHttpRequestBody";

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
	 * JS expression running `code` in the sandbox with `extras` as its input.
	 * `sync` picks `vm.run` over `vm.runAsync` — same result, but it skips the
	 * per-call timeout race. Use it wherever the interpreted block used `run`.
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
};

/** helpers the generated code calls as `lib.x` — anything too big to inline */
export const compilerLib = {
	log: runConsoleLog,
	httpRequest: runHttpRequest,
	isoDate: (value: any) => dayjs(value).toISOString(),
};

/** mirrors JsVM.truthy / the `is_empty` operator, inlined into every program */
const PRELUDE = `const vars = ctx.vars;
const $truthy = (v) => { const t = typeof v; return t === "bigint" || t === "number" || t === "string" || t === "boolean" ? !!v : (t === "object" && v !== null); };
const $isEmpty = (v) => v === null || v === undefined || v === "" || (typeof v === "object" && Object.keys(v).length === 0);`;

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

export function compileGraph(blocks: BlockDTOType[], edges: EdgeDTOSchemaType) {
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
		const method = sync ? "run" : "runAsync";
		return `(await ctx.vm.${method}(${JSON.stringify(code)}${extras ? `, ${extras}` : ""}))`;
	}

	function emit(id: string, inVar: string, tail: string): string {
		const block = byId.get(id);
		if (!block) throw new Error(`Block not found: ${id}`);
		const emitter = emitters[block.type as BlockTypes];
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
				return typeof raw === "string" && raw.startsWith("js:")
					? js(raw.slice(3), inVar)
					: JSON.stringify(raw ?? null);
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

	const source = `${PRELUDE}\n${body}`;
	const compiled = new AsyncFunction("ctx", "input", "lib", source);
	return {
		source,
		run: (ctx: any, input?: any) => compiled(ctx, input, compilerLib),
	};
}
