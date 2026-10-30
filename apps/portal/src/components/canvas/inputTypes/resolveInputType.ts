import { BLOCK_TYPES } from "../blocks/blockTypes";
import { readDbBinding } from "../panel/blocks/db/conditions";
import { blockAssignedGlobals } from "../panel/scriptGlobals";
import { isPluginType } from "../plugins/pluginBlocks";
import {
	CHAIN_FAILURE,
	fieldMapOutput,
	fixedOutput,
	kvOperationOutput,
	loopItem,
	PASS_THROUGH,
	QUEUE_RESULT,
	scriptOf,
	tuple,
	valueType,
} from "./blockOutputs";
import { DB_TABLE_BLOCKS, type DbMeta, dbBlockOutput } from "./dbOutputType";

type GraphNode = { id: string; type?: string; data?: unknown };
type GraphEdge = { source: string; target: string; sourceHandle?: string | null };
type Data = Record<string, unknown>;

/** What a script returns, given the type of its own `input`. */
export type InferOutput = (source: string, inputType: string) => Promise<string>;

/** What the resolver reads from outside the graph. */
export type InputTypeContext = {
	infer: InferOutput;
	/** the tables and columns of a database connection, or null when unreadable */
	loadDbMeta: (connectionId: string) => Promise<DbMeta | null>;
	/** the type a plugin block declares for one of its handles, or null when it declares none */
	pluginOutput?: (type: string, kind: string) => string | null;
};

/** Blocks further back than this are not followed: `any` beats a slow editor. */
const MAX_DEPTH = 12;

/** Which handle of its block an edge leaves from; the canvas names them `<blockId>-<kind>`. */
function handleKind({ source, sourceHandle }: GraphEdge): string {
	if (!sourceHandle) return "source";
	return sourceHandle.startsWith(`${source}-`)
		? sourceHandle.slice(source.length + 1)
		: sourceHandle;
}

/** Several upstream blocks can feed one: only one of them ran, so the type is any of them. */
function union(types: string[]): string {
	const unique = [...new Set(types)];
	if (unique.length === 0 || unique.includes("any")) return "any";
	return unique.length === 1 ? unique[0] : unique.map((type) => `(${type})`).join(" | ");
}

/** A Set / Get Var block's rows: its own fields in Single mode, `items` in Multiple. */
const rowsOf = (data: Data): Data[] =>
	data.mode === "multiple" && Array.isArray(data.items) ? (data.items as Data[]) : [data];

/** The blocks that open a chain by their `success` handle rather than `source`. */
export const SAVES_ON_SUCCESS: ReadonlySet<string> = new Set([
	BLOCK_TYPES.db_exists,
	BLOCK_TYPES.db_transaction,
	BLOCK_TYPES.retry,
	BLOCK_TYPES.queue_send,
]);

/**
 * Works out the type a block hands on, and so the type of `input` after it.
 * One resolver shares its work, so ask it for everything the canvas needs.
 *
 * `input` is the union of what the blocks wired into a block hand over. A
 * plugin block hands over the type its manifest declares. Custom blocks, and
 * anything it cannot place or a cycle, are `any`, which is what the editor
 * showed before.
 */
export function createResolver(nodes: GraphNode[], edges: GraphEdge[], ctx: InputTypeContext) {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const outputs = new Map<string, Promise<string>>();
	const rowTypes = new Map<string, Promise<string>>();
	const variables = new Map<string, Promise<string>>();
	const resolving = new Set<string>();
	// names a script assigns: whatever it stores is not known
	const scriptWrites = new Set(
		nodes.flatMap((node) => blockAssignedGlobals(node.type ?? "", (node.data ?? {}) as Data)),
	);

	const inputOf = async (id: string, path: string[]): Promise<string> =>
		union(
			await Promise.all(
				edges
					.filter((edge) => edge.target === id)
					.map((edge) => outputOf(edge.source, handleKind(edge), path)),
			),
		);

	/** The last block of a line of blocks starting at `start`; a fork ends the line. */
	const lineEnd = (start: string | null): string | null => {
		const seen = new Set<string>();
		let current = start;
		while (current && !seen.has(current)) {
			seen.add(current);
			const next = edges.filter((e) => e.source === current && handleKind(e) === "source");
			if (next.length !== 1) break;
			current = next[0].target;
		}
		return current;
	};

	const firstOn = (ownerId: string, kind: string) =>
		edges.find((e) => e.source === ownerId && handleKind(e) === kind)?.target ?? null;

	/** An orchestrator's branches: the ones its `order` names first, the rest as wired. */
	const branchesOf = (id: string, order: unknown): string[] => {
		const wired = edges
			.filter((e) => e.source === id && handleKind(e) === "orchestrate")
			.map((e) => e.target);
		const named = Array.isArray(order) ? order.filter((t) => wired.includes(t)) : [];
		return [...new Set([...named, ...wired])];
	};

	/** What one Set Var row stores. */
	const rowType = (id: string, row: number): Promise<string> => {
		const cacheKey = `${id}\u0000${row}`;
		let type = rowTypes.get(cacheKey);
		if (!type) {
			const data = (byId.get(id)?.data ?? {}) as Data;
			type = (async () =>
				valueType(rowsOf(data)[row]?.value, await inputOf(id, [id]), ctx.infer))();
			rowTypes.set(cacheKey, type);
		}
		return type;
	};

	/** What a variable holds: whatever every Set Var that writes it stores. */
	const variableType = (name: string): Promise<string> => {
		let type = variables.get(name);
		if (!type) {
			// a variable that is read while it is being worked out is a cycle
			if (resolving.has(name) || scriptWrites.has(name)) return Promise.resolve("any");
			resolving.add(name);
			const writes = nodes.flatMap((node) =>
				node.type === BLOCK_TYPES.setvar
					? rowsOf((node.data ?? {}) as Data).flatMap((row, index) =>
							String(row.key ?? "").trim() === name ? [rowType(node.id, index)] : [],
						)
					: [],
			);
			type = Promise.all(writes)
				.then(union)
				.finally(() => resolving.delete(name));
			variables.set(name, type);
		}
		return type;
	};

	const compute = async (node: GraphNode, kind: string, path: string[]): Promise<string> => {
		const type = node.type ?? "";
		const data = (node.data ?? {}) as Data;
		const here = [...path, node.id];
		const input = () => inputOf(node.id, here);
		const fixed = fixedOutput(type, data);

		if (PASS_THROUGH.has(type) || (type === BLOCK_TYPES.triggerWorkflow && fixed === null)) {
			return input();
		}
		if (type in CHAIN_FAILURE) {
			if (kind === "failure") return CHAIN_FAILURE[type];
			// the first block of the chain gets what the block got
			if (kind === "executor") return input();
			const last = kind === "success" ? lineEnd(firstOn(node.id, "executor")) : null;
			return last ? outputOf(last, "source", path) : "any";
		}
		if (type === BLOCK_TYPES.forloop || type === BLOCK_TYPES.foreachloop) {
			if (kind === "executor") {
				const items = type === BLOCK_TYPES.foreachloop && data.useParam ? await input() : "any";
				return loopItem(type, data, items);
			}
			return kind === "source" ? "undefined" : "any";
		}
		if (type === BLOCK_TYPES.orchestrator) {
			if (kind === "orchestrate") return input();
			if (kind !== "source") return "any";
			const results = await Promise.all(
				branchesOf(node.id, data.order).map((start) => {
					const end = lineEnd(start);
					return end ? outputOf(end, "source", path) : Promise.resolve("any");
				}),
			);
			// a branch that failed leaves its error message in its slot
			return tuple(data.onError === "settle" ? results.map((r) => `(${r}) | string`) : results);
		}
		if (type === BLOCK_TYPES.setvar && kind === "source") {
			const rows = rowsOf(data);
			const types = await Promise.all(rows.map((_, index) => rowType(node.id, index)));
			return data.mode === "multiple" ? tuple(types) : (types[0] ?? "any");
		}
		if (type === BLOCK_TYPES.getvar && kind === "source") {
			const types = await Promise.all(
				rowsOf(data).map((row) => variableType(String(row.key ?? "").trim())),
			);
			return data.mode === "multiple" ? tuple(types) : (types[0] ?? "any");
		}
		if (type === BLOCK_TYPES.kv_operations && kind === "source") {
			return kvOperationOutput(data, await input());
		}
		if (type === BLOCK_TYPES.transformer && kind === "source" && data.useJs !== true) {
			return fieldMapOutput(data.fieldMap, await input());
		}
		if (type === BLOCK_TYPES.queue_send) {
			if (kind === "failure") return QUEUE_RESULT;
			// raw mode hands on whatever the code returns
			if (kind === "success" && data.mode === "raw" && typeof data.js === "string") {
				return ctx.infer(data.js, await input());
			}
			return kind === "success" ? QUEUE_RESULT : "any";
		}
		if (type === BLOCK_TYPES.db_exists && kind === "failure") return input();
		if (DB_TABLE_BLOCKS.has(type) && (kind === "source" || kind === "success")) {
			const { connectionId, tableName } = readDbBinding({ data });
			const meta = connectionId ? await ctx.loadDbMeta(connectionId) : null;
			return dbBlockOutput(type, data, meta, tableName);
		}
		// a plugin block says what it hands on; body handles and silence are `any`
		if (isPluginType(type)) return ctx.pluginOutput?.(type, kind) ?? "any";
		if (kind !== "source") return "any";
		if (fixed !== null) return fixed;
		const script = scriptOf(type, data);
		return typeof script === "string" ? ctx.infer(script, await input()) : "any";
	};

	const outputOf = (id: string, kind: string, path: string[]): Promise<string> => {
		const node = byId.get(id);
		if (!node || path.includes(id) || path.length >= MAX_DEPTH) return Promise.resolve("any");
		const cacheKey = `${id}\u0000${kind}`;
		let output = outputs.get(cacheKey);
		if (!output) {
			output = compute(node, kind, path);
			outputs.set(cacheKey, output);
		}
		return output;
	};

	return {
		/** The type of `input` for a block. */
		inputType: (blockId: string) => inputOf(blockId, [blockId]),
		/** What a block hands on its `kind` handle (`source` unless it branches). */
		outputType: (blockId: string, kind = "source") => outputOf(blockId, kind, []),
		/** What row `row` of a Set Var block stores. */
		setVarType: rowType,
	};
}

export type Resolver = ReturnType<typeof createResolver>;

export const resolveInputType = (
	blockId: string,
	nodes: GraphNode[],
	edges: GraphEdge[],
	ctx: InputTypeContext,
): Promise<string> => createResolver(nodes, edges, ctx).inputType(blockId);
