import { eq, sql } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import {
	type CanvasVersionKind,
	canvasVersionsEntity,
	customBlocksListEntity,
	middlewaresEntity,
	routesEntity,
	testSuitesEntity,
	workflowsEntity,
} from "../../db/schema";

/**
 * What a project's production versions use (#740), read once so a gate can walk
 * "uses of uses" in memory. Only what the walk needs is taken out of each
 * snapshot, so a promote does not pull every canvas of the project.
 */

/** One route, workflow, custom block or middleware that has a promoted version. */
export type ProdEntry = {
	kind: CanvasVersionKind;
	id: string;
	name: string;
	versionId: string;
	/** every block type on the promoted canvas: built-in ones and custom block names */
	blockTypes: Set<string>;
	/** a route's promoted middlewares, before and after */
	middlewares: string[];
	/** a middleware's promoted chain: custom block ids */
	chain: string[];
};

export type BlockRow = {
	id: string;
	name: string;
	prodVersionId: string | null;
	usage: "flow" | "middleware" | "test";
};

export type MiddlewareRow = { id: string; name: string; prodVersionId: string | null };

/** A suite that names custom blocks as its setup, teardown or input loader. */
export type HookSuite = {
	id: string;
	name: string;
	target: { kind: "route" | "workflow"; id: string; name: string; prodVersionId: string | null };
	blockIds: string[];
};

export type ProdGraph = {
	projectId: string;
	/** by `kind:id` */
	entries: Map<string, ProdEntry>;
	blocksByName: Map<string, BlockRow>;
	blocksById: Map<string, BlockRow>;
	middlewares: Map<string, MiddlewareRow>;
	hookSuites: HookSuite[];
};

export const entryKey = (kind: CanvasVersionKind, id: string) => `${kind}:${id}`;

/** A raw jsonb read may arrive as text; either way the caller gets the value. */
function asJson<T>(value: unknown, fallback: T): T {
	if (typeof value === "string") {
		try {
			return JSON.parse(value) as T;
		} catch {
			return fallback;
		}
	}
	return (value ?? fallback) as T;
}

const snapshot = canvasVersionsEntity.snapshot;
const promoted = {
	types: sql<unknown>`jsonb_path_query_array(${snapshot}, '$.blocks[*].type')`,
	middlewares: sql<unknown>`${snapshot} -> 'settings' -> 'middlewares'`,
	chain: sql<unknown>`${snapshot} -> 'settings' -> 'chain'`,
};

export async function loadProdGraph(
	projectId: string,
	tx: DbTransactionType | typeof db = db,
): Promise<ProdGraph> {
	const entries = new Map<string, ProdEntry>();
	const add = (
		kind: CanvasVersionKind,
		rows: {
			id: string;
			name: string | null;
			versionId: string | null;
			types: unknown;
			middlewares: unknown;
			chain: unknown;
		}[],
	) => {
		for (const row of rows) {
			if (!row.versionId) continue;
			const middlewares = asJson<{ before?: string[]; after?: string[] } | null>(
				row.middlewares,
				null,
			);
			entries.set(entryKey(kind, row.id), {
				kind,
				id: row.id,
				name: row.name ?? row.id,
				versionId: row.versionId,
				blockTypes: new Set(asJson<string[]>(row.types, [])),
				middlewares: [...(middlewares?.before ?? []), ...(middlewares?.after ?? [])],
				chain: asJson<string[]>(row.chain, []),
			});
		}
	};

	const read = (table: typeof routesEntity | typeof workflowsEntity | typeof middlewaresEntity) =>
		tx
			.select({ id: table.id, name: table.name, versionId: table.prodVersionId, ...promoted })
			.from(table)
			.innerJoin(canvasVersionsEntity, eq(canvasVersionsEntity.id, table.prodVersionId))
			.where(eq(table.projectId, projectId));

	add("route", await read(routesEntity));
	add("workflow", await read(workflowsEntity));
	add("middleware", await read(middlewaresEntity));
	add(
		"custom_block",
		await tx
			.select({
				id: customBlocksListEntity.id,
				name: customBlocksListEntity.name,
				versionId: customBlocksListEntity.prodVersionId,
				...promoted,
			})
			.from(customBlocksListEntity)
			.innerJoin(
				canvasVersionsEntity,
				eq(canvasVersionsEntity.id, customBlocksListEntity.prodVersionId),
			)
			.where(eq(customBlocksListEntity.projectId, projectId)),
	);

	const blocks = await tx
		.select({
			id: customBlocksListEntity.id,
			name: customBlocksListEntity.name,
			prodVersionId: customBlocksListEntity.prodVersionId,
			usage: customBlocksListEntity.usage,
		})
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.projectId, projectId));
	const middlewares = await tx
		.select({
			id: middlewaresEntity.id,
			name: middlewaresEntity.name,
			prodVersionId: middlewaresEntity.prodVersionId,
		})
		.from(middlewaresEntity)
		.where(eq(middlewaresEntity.projectId, projectId));

	return {
		projectId,
		entries,
		blocksByName: new Map(blocks.map((row) => [row.name, row])),
		blocksById: new Map(blocks.map((row) => [row.id, row])),
		middlewares: new Map(middlewares.map((row) => [row.id, row])),
		hookSuites: await loadHookSuites(projectId, tx),
	};
}

/** Every suite of the project that names a custom block as a hook, with its target. */
export async function loadHookSuites(
	projectId: string,
	tx: DbTransactionType | typeof db = db,
): Promise<HookSuite[]> {
	const select = {
		id: testSuitesEntity.id,
		name: testSuitesEntity.name,
		setup: testSuitesEntity.setupBlockId,
		teardown: testSuitesEntity.teardownBlockId,
		input: testSuitesEntity.input,
	};
	const [routeSuites, workflowSuites] = await Promise.all([
		tx
			.select({
				...select,
				targetId: routesEntity.id,
				targetName: routesEntity.name,
				prodVersionId: routesEntity.prodVersionId,
			})
			.from(testSuitesEntity)
			.innerJoin(routesEntity, eq(routesEntity.id, testSuitesEntity.routeId))
			.where(eq(routesEntity.projectId, projectId)),
		tx
			.select({
				...select,
				targetId: workflowsEntity.id,
				targetName: workflowsEntity.name,
				prodVersionId: workflowsEntity.prodVersionId,
			})
			.from(testSuitesEntity)
			.innerJoin(workflowsEntity, eq(workflowsEntity.id, testSuitesEntity.workflowId))
			.where(eq(workflowsEntity.projectId, projectId)),
	]);

	const suites: HookSuite[] = [];
	const collect = (kind: "route" | "workflow", rows: typeof routeSuites) => {
		for (const row of rows) {
			const loader = row.input?.source === "loader" ? row.input.loaderBlockId : null;
			const blockIds = [row.setup, row.teardown, loader].filter((id): id is string => !!id);
			if (!blockIds.length) continue;
			suites.push({
				id: row.id,
				name: row.name,
				target: {
					kind,
					id: row.targetId,
					name: row.targetName ?? row.targetId,
					prodVersionId: row.prodVersionId,
				},
				blockIds,
			});
		}
	};
	collect("route", routeSuites);
	collect("workflow", workflowSuites);
	return suites;
}
