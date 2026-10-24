import { BLOCK_TYPES } from "../blocks/blockTypes";
import { readDbBinding } from "../panel/blocks/db/conditions";
import { CHAIN_FAILURE, fixedOutput, loopItem, PASS_THROUGH, scriptOf } from "./blockOutputs";
import { DB_TABLE_BLOCKS, type DbMeta, dbBlockOutput } from "./dbOutputType";

type GraphNode = { id: string; type?: string; data?: unknown };
type GraphEdge = { source: string; target: string; sourceHandle?: string | null };

/** What a script returns, given the type of its own `input`. */
export type InferOutput = (source: string, inputType: string) => Promise<string>;

/** What the resolver reads from outside the graph. */
export type InputTypeContext = {
	infer: InferOutput;
	/** the tables and columns of a database connection, or null when unreadable */
	loadDbMeta: (connectionId: string) => Promise<DbMeta | null>;
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

/**
 * The type of `input` for a block: the union of what the blocks wired into it
 * hand over. JS Runner, DB Native and the table blocks are typed so far;
 * anything else upstream, or a cycle, makes it `any`, which is what the editor
 * showed before.
 */
export async function resolveInputType(
	blockId: string,
	nodes: GraphNode[],
	edges: GraphEdge[],
	ctx: InputTypeContext,
): Promise<string> {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const outputs = new Map<string, Promise<string>>();

	const inputOf = async (id: string, path: string[]): Promise<string> =>
		union(
			await Promise.all(
				edges
					.filter((edge) => edge.target === id)
					.map((edge) => outputOf(edge.source, handleKind(edge), path)),
			),
		);

	/** The last block of an executor chain, as long as it is a single line of blocks. */
	const chainEnd = (ownerId: string): string | null => {
		const start = edges.find((e) => e.source === ownerId && handleKind(e) === "executor");
		const seen = new Set<string>();
		let current = start?.target ?? null;
		while (current && !seen.has(current)) {
			seen.add(current);
			const next = edges.filter((e) => e.source === current && handleKind(e) === "source");
			if (next.length !== 1) break;
			current = next[0].target;
		}
		return current;
	};

	const compute = async (node: GraphNode, kind: string, path: string[]): Promise<string> => {
		const type = node.type ?? "";
		const data = (node.data ?? {}) as Record<string, unknown>;
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
			const last = kind === "success" ? chainEnd(node.id) : null;
			return last ? outputOf(last, "source", path) : "any";
		}
		if (type === BLOCK_TYPES.forloop || type === BLOCK_TYPES.foreachloop) {
			if (kind === "executor")
				return loopItem(
					type,
					data,
					type === BLOCK_TYPES.foreachloop && data.useParam ? await input() : "any",
				);
			return kind === "source" ? "undefined" : "any";
		}
		if (type === BLOCK_TYPES.orchestrator) return kind === "orchestrate" ? input() : "any";
		if (type === BLOCK_TYPES.db_exists && kind === "failure") return input();
		if (DB_TABLE_BLOCKS.has(type) && (kind === "source" || kind === "success")) {
			const { connectionId, tableName } = readDbBinding({ data });
			const meta = connectionId ? await ctx.loadDbMeta(connectionId) : null;
			return dbBlockOutput(type, data, meta, tableName);
		}
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

	return inputOf(blockId, [blockId]);
}
