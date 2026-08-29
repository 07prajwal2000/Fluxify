import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { BlockTypes } from "@fluxify/blocks";
import { db, DbTransactionType } from "../../db";
import {
	blocksEntity,
	customBlocksListEntity,
	edgesEntity,
	routesEntity,
	workflowsEntity,
} from "../../db/schema";
import type { CanvasParent } from "./types";

type BlockRow = typeof blocksEntity.$inferInsert;
type EdgeRow = typeof edgesEntity.$inferInsert;

/**
 * The one place a canvas parent maps to storage: which table owns it, and which
 * foreign key on `blocks`/`edges` points at it. A fourth parent is a row here.
 */
const parentTables = {
	route: { table: routesEntity, column: "routeId" },
	custom_block: { table: customBlocksListEntity, column: "customBlockId" },
	workflow: { table: workflowsEntity, column: "workflowId" },
} as const satisfies Record<
	CanvasParent["type"],
	{ table: PgTable & { id: any; projectId: any; updatedAt: any }; column: string }
>;

/** The table a parent of this type lives in. */
export function parentTable(type: CanvasParent["type"]) {
	return parentTables[type].table;
}

/**
 * `parent_type`/`parent_id` are generated columns, so writes still go through
 * the real foreign key — that is what keeps ON DELETE CASCADE working for every
 * parent. Reads filter on the generated pair.
 */
export function parentKeys(parent: CanvasParent) {
	const keys = { routeId: null, customBlockId: null, workflowId: null } as Record<
		string,
		string | null
	>;
	keys[parentTables[parent.type].column] = parent.id;
	return keys as {
		routeId: string | null;
		customBlockId: string | null;
		workflowId: string | null;
	};
}

function ownedBy(
	table: typeof blocksEntity | typeof edgesEntity,
	parent: CanvasParent,
) {
	return and(
		eq(table.parentType, parent.type),
		eq(table.parentId, parent.id),
	);
}

export async function upsertBlocks(blocks: BlockRow[], tx?: DbTransactionType) {
	if (!blocks.length) return;
	await (tx ?? db)
		.insert(blocksEntity)
		.values(blocks)
		.onConflictDoUpdate({
			target: blocksEntity.id,
			set: {
				type: sql`excluded.type`,
				position: sql`excluded.position`,
				data: sql`excluded.data`,
				updatedAt: sql`excluded.updated_at`,
				routeId: sql`excluded.route_id`,
				customBlockId: sql`excluded.custom_block_id`,
				workflowId: sql`excluded.workflow_id`,
			},
		});
}

export async function upsertEdges(edges: EdgeRow[], tx?: DbTransactionType) {
	if (!edges.length) return;
	await (tx ?? db)
		.insert(edgesEntity)
		.values(edges)
		.onConflictDoUpdate({
			target: edgesEntity.id,
			set: {
				from: sql`excluded.from`,
				to: sql`excluded.to`,
				fromHandle: sql`excluded.from_handle`,
				toHandle: sql`excluded.to_handle`,
				routeId: sql`excluded.route_id`,
				customBlockId: sql`excluded.custom_block_id`,
				workflowId: sql`excluded.workflow_id`,
			},
		});
}

/** the entrypoint and error handler are structural — a client cannot delete them */
export async function deleteBlocks(blockIds: string[], tx?: DbTransactionType) {
	if (!blockIds.length) return;
	await (tx ?? db)
		.delete(blocksEntity)
		.where(
			and(
				inArray(blocksEntity.id, blockIds),
				ne(blocksEntity.type, BlockTypes.entrypoint),
				ne(blocksEntity.type, BlockTypes.errorHandler),
			),
		);
}

/** Bypasses the entrypoint/errorHandler protection in `deleteBlocks` above — only
 *  for the trusted merge path where a verified AI harness output is replacing a
 *  stale structural block. Never call this for a client-initiated delete. */
export async function deleteStructuralBlocks(
	blockIds: string[],
	tx?: DbTransactionType,
) {
	if (!blockIds.length) return;
	await (tx ?? db).delete(blocksEntity).where(inArray(blocksEntity.id, blockIds));
}

export async function deleteEdges(edgeIds: string[], tx?: DbTransactionType) {
	if (!edgeIds.length) return;
	await (tx ?? db).delete(edgesEntity).where(inArray(edgesEntity.id, edgeIds));
}

export async function getBlocksCountByType(
	parent: CanvasParent,
	types: BlockTypes[],
	tx?: DbTransactionType,
) {
	return await (tx ?? db)
		.select({ count: count(blocksEntity.id), type: blocksEntity.type })
		.from(blocksEntity)
		.where(and(ownedBy(blocksEntity, parent), inArray(blocksEntity.type, types)))
		.groupBy(blocksEntity.type);
}

export async function getBlocks(parent: CanvasParent, tx?: DbTransactionType) {
	return await (tx ?? db)
		.select({
			id: blocksEntity.id,
			type: blocksEntity.type,
			data: blocksEntity.data,
			position: blocksEntity.position,
		})
		.from(blocksEntity)
		.where(ownedBy(blocksEntity, parent));
}

export async function getEdges(parent: CanvasParent, tx?: DbTransactionType) {
	return await (tx ?? db)
		.select({
			id: edgesEntity.id,
			from: edgesEntity.from,
			to: edgesEntity.to,
			fromHandle: edgesEntity.fromHandle,
			toHandle: edgesEntity.toHandle,
		})
		.from(edgesEntity)
		.where(ownedBy(edgesEntity, parent));
}

/**
 * Canvases in the executable shape: one row per block with its outgoing edges
 * folded into `data.connections`. That is what the block builder and the
 * compiler consume, and it is the only place the fold happens.
 */
export async function getGraphsWithConnections(
	parentType: CanvasParent["type"],
	parentIds: string[],
	tx?: DbTransactionType,
) {
	if (!parentIds.length) return [];
	const where = (table: typeof blocksEntity | typeof edgesEntity) =>
		and(
			eq(table.parentType, parentType),
			inArray(table.parentId, parentIds),
		);

	const [blocks, edges] = await Promise.all([
		(tx ?? db)
			.select({
				id: blocksEntity.id,
				parentId: blocksEntity.parentId,
				type: blocksEntity.type,
				position: blocksEntity.position,
				data: blocksEntity.data,
			})
			.from(blocksEntity)
			.where(where(blocksEntity)),
		(tx ?? db)
			.select({
				id: edgesEntity.id,
				from: edgesEntity.from,
				to: edgesEntity.to,
				fromHandle: edgesEntity.fromHandle,
				toHandle: edgesEntity.toHandle,
			})
			.from(edgesEntity)
			.where(where(edgesEntity)),
	]);

	const connectionsByBlock = new Map<string, Record<string, unknown>[]>();
	for (const edge of edges) {
		if (!edge.from || !edge.to) continue;
		const list = connectionsByBlock.get(edge.from) ?? [];
		list.push({
			id: edge.id,
			to: edge.to,
			fromHandle: edge.fromHandle,
			toHandle: edge.toHandle,
		});
		connectionsByBlock.set(edge.from, list);
	}

	return blocks.map((block) => ({
		id: block.id,
		parentId: block.parentId,
		type: block.type,
		data: {
			...((block.data as Record<string, unknown>) ?? {}),
			position: block.position,
			connections: connectionsByBlock.get(block.id) ?? [],
		},
	}));
}

/** exists *and* is visible to the caller's projects — `*` is a system admin */
export async function parentExists(
	parent: CanvasParent,
	projectIds: string[] = [],
	tx?: DbTransactionType,
) {
	const isSystemAdmin = projectIds.some((id) => id === "*");
	const table = parentTable(parent.type);
	const rows = await (tx ?? db)
		.select({ id: table.id })
		.from(table)
		.where(
			and(
				eq(table.id, parent.id),
				isSystemAdmin ? undefined : inArray(table.projectId, projectIds),
			),
		)
		.limit(1);
	return rows.length > 0;
}

/**
 * The custom block names usable on this canvas — a custom block instance stores
 * the block's `name` as its type (see `blocksLoader`'s customBlockGetter), so
 * this is the other half of the valid-type set, next to `BlockTypes`.
 */
export async function getCustomBlockNames(
	parent: CanvasParent,
	tx?: DbTransactionType,
): Promise<string[]> {
	return (await getProjectCustomBlocks(parent, tx)).map((row) => row.name);
}

/** Same set as `getCustomBlockNames`, with the id needed to read each canvas. */
export async function getProjectCustomBlocks(
	parent: CanvasParent,
	tx?: DbTransactionType,
): Promise<{ id: string; name: string }[]> {
	const table = parentTable(parent.type);
	return await (tx ?? db)
		.select({ id: customBlocksListEntity.id, name: customBlocksListEntity.name })
		.from(customBlocksListEntity)
		.where(
			eq(
				customBlocksListEntity.projectId,
				(tx ?? db)
					.select({ projectId: table.projectId })
					.from(table)
					.where(eq(table.id, parent.id)),
			),
		);
}

/**
 * Which custom block each of these canvases holds a block of — the call graph a
 * recursion check walks. Only the type matters, so this stays one narrow read
 * however big the canvases are.
 */
export async function getCustomBlockCalls(
	customBlockIds: string[],
	tx?: DbTransactionType,
): Promise<{ parentId: string; type: string }[]> {
	if (!customBlockIds.length) return [];
	const rows = await (tx ?? db)
		.selectDistinct({ parentId: blocksEntity.parentId, type: blocksEntity.type })
		.from(blocksEntity)
		.where(
			and(
				eq(blocksEntity.parentType, "custom_block"),
				inArray(blocksEntity.parentId, customBlockIds),
			),
		);
	return rows.flatMap((row) =>
		row.parentId && row.type ? [{ parentId: row.parentId, type: row.type }] : [],
	);
}

export async function touchParent(
	parent: CanvasParent,
	tx?: DbTransactionType,
) {
	const table = parentTable(parent.type);
	await (tx ?? db)
		.update(table)
		.set({ updatedAt: sql`now()` })
		.where(eq(table.id, parent.id));
}
