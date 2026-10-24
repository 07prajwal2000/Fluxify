import { BLOCK_TYPES } from "../blocks/blockTypes";
import { readDbBinding } from "../panel/blocks/db/conditions";
import { allOutputType, type DbMeta, dbRowType, singleOutputType } from "./dbOutputType";

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

/** A plain data edge (`<blockId>-source`); the other handles (loop body, branches, ...) carry something else. */
const isDataEdge = ({ source, sourceHandle }: GraphEdge) =>
	!sourceHandle || sourceHandle === "source" || sourceHandle === `${source}-source`;

/** Several upstream blocks can feed one: only one of them ran, so the type is any of them. */
function union(types: string[]): string {
	const unique = [...new Set(types)];
	if (unique.length === 0 || unique.includes("any")) return "any";
	return unique.length === 1 ? unique[0] : unique.map((type) => `(${type})`).join(" | ");
}

/** What a get-single / get-all block hands on, from the columns it reads. */
async function dbOutput(node: GraphNode, { loadDbMeta }: InputTypeContext): Promise<string> {
	const data = (node.data ?? {}) as Record<string, unknown>;
	const { connectionId, tableName } = readDbBinding({ data });
	const meta = connectionId ? await loadDbMeta(connectionId) : null;
	const row = dbRowType(meta, { tableName, columns: data.columns, joins: data.joins });
	return node.type === BLOCK_TYPES.db_getsingle
		? singleOutputType(row)
		: allOutputType(row, data.paging);
}

/**
 * The type of `input` for a block: the union of what the blocks wired into it
 * hand over. JS Runners and DB Get Single / Get All are typed so far; anything
 * else upstream, or a cycle, makes it `any`, which is what the editor showed
 * before.
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
					.map((edge) => (isDataEdge(edge) ? outputOf(edge.source, path) : Promise.resolve("any"))),
			),
		);

	const outputOf = (id: string, path: string[]): Promise<string> => {
		const node = byId.get(id);
		if (node?.type === BLOCK_TYPES.db_getsingle || node?.type === BLOCK_TYPES.db_getall) {
			let output = outputs.get(id);
			if (!output) {
				output = dbOutput(node, ctx);
				outputs.set(id, output);
			}
			return output;
		}
		const script = (node?.data as { value?: unknown } | undefined)?.value;
		if (node?.type !== BLOCK_TYPES.jsrunner || typeof script !== "string") {
			return Promise.resolve("any");
		}
		if (path.includes(id) || path.length >= MAX_DEPTH) return Promise.resolve("any");
		let output = outputs.get(id);
		if (!output) {
			output = inputOf(id, [...path, id]).then((input) => ctx.infer(script, input));
			outputs.set(id, output);
		}
		return output;
	};

	return inputOf(blockId, [blockId]);
}
