import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { BlockTypes } from "@fluxify/blocks";
import { db, DbTransactionType } from "../../db";
import {
	blocksEntity,
	customBlocksListEntity,
	edgesEntity,
	routesEntity,
} from "../../db/schema";
import type { CanvasParent } from "./types";

type BlockRow = typeof blocksEntity.$inferInsert;
type EdgeRow = typeof edgesEntity.$inferInsert;

/**
 * `parent_type`/`parent_id` are generated columns, so writes still go through
 * the real foreign key — that is what keeps ON DELETE CASCADE working for both
 * parents. Reads filter on the generated pair.
 */
export function parentKeys(parent: CanvasParent) {
	return parent.type === "route"
		? { routeId: parent.id, customBlockId: null }
		: { routeId: null, customBlockId: parent.id };
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
	const table =
		parent.type === "route" ? routesEntity : customBlocksListEntity;
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

export async function touchParent(
	parent: CanvasParent,
	tx?: DbTransactionType,
) {
	const table =
		parent.type === "route" ? routesEntity : customBlocksListEntity;
	await (tx ?? db)
		.update(table)
		.set({ updatedAt: sql`now()` })
		.where(eq(table.id, parent.id));
}
