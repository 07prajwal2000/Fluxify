import type { BlockDTOType, EdgeDTOSchemaType } from "../../builderTypes";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";

/** records every adapter call so the tests can assert what reached knex */
export function createDbAdapter(results: Record<string, any> = {}) {
	const calls: { method: string; args: any[] }[] = [];
	const record =
		(method: string) =>
		async (...args: any[]) => {
			calls.push({ method, args });
			return results[method];
		};
	return {
		calls,
		adapter: {
			getSingle: record("getSingle"),
			getAll: record("getAll"),
			getPage: record("getPage"),
			insert: record("insert"),
			insertBulk: record("insertBulk"),
			update: record("update"),
			delete: record("delete"),
			raw: record("raw"),
			startTransaction: record("startTransaction"),
			commitTransaction: record("commitTransaction"),
			rollbackTransaction: record("rollbackTransaction"),
		},
	};
}

export function createContext(adapter: any) {
	const vars: Record<string, any> = {};
	return {
		route: "/db",
		apiId: "api-1",
		projectId: "proj-1",
		vars,
		dbFactory: { getDbAdapter: () => adapter },
		stopper: { timeoutEnd: 0, duration: 10000 },
	} as any;
}

export const block = (id: string, type: BlockTypes, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});

export const edge = (from: string, to: string, toHandle = "source") => ({
	id: `edge-${from}-${to}-${toHandle}`,
	from,
	to,
	fromHandle: "source",
	toHandle,
});

/** entrypoint -> block under test -> response */
export function graphAround(target: BlockDTOType) {
	const blocks = [
		block("in", BlockTypes.entrypoint),
		target,
		block("out", BlockTypes.response, { httpCode: "200" }),
	];
	const edges: EdgeDTOSchemaType = [edge("in", target.id), edge(target.id, "out")];
	return { blocks, edges };
}

export async function runAround(target: BlockDTOType, input: any, mock: any) {
	const { blocks, edges } = graphAround(target);
	const { run, source } = compileGraph(blocks, edges);
	const ctx = createContext(mock.adapter);
	const result = await run(ctx, input);
	return { result, ctx, source };
}

