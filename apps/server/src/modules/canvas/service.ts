import { BlockTypes } from "@fluxify/blocks";
import { db, type DbTransactionType } from "../../db";
import { BadRequestError } from "../../errors/badRequestError";
import { NotFoundError } from "../../errors/notFoundError";
import {
	CHAN_ON_CUSTOM_BLOCK_CHANGE,
	CHAN_ON_ROUTE_CHANGE,
	publishMessage,
} from "../../db/redis";
import {
	deleteBlocks,
	deleteEdges,
	getBlocks,
	getBlocksCountByType,
	getEdges,
	parentExists,
	parentKeys,
	touchParent,
	upsertBlocks,
	upsertEdges,
} from "./repository";
import type { CanvasChanges, CanvasParent } from "./types";

const CHANGE_CHANNEL = {
	route: CHAN_ON_ROUTE_CHANGE,
	custom_block: CHAN_ON_CUSTOM_BLOCK_CHANGE,
} as const;

const NOT_FOUND = {
	route: "Route not found",
	custom_block: "Custom Block not found",
} as const;

/**
 * An edge whose endpoint is neither in this payload nor already stored would
 * otherwise surface as a raw foreign key violation. Catch it here so every
 * caller gets the same readable error naming the block.
 */
async function assertEdgeTargetsExist(
	parent: CanvasParent,
	data: CanvasChanges,
	deleteBlockIds: string[],
	tx?: DbTransactionType,
) {
	const incoming = new Set(data.changes.blocks.map((b) => b.id));
	const referenced = new Set<string>();
	for (const edge of data.changes.edges) {
		for (const id of [edge.from, edge.to])
			if (!incoming.has(id)) referenced.add(id);
	}
	if (referenced.size === 0) return;

	// ponytail: reads every block of the canvas. Fine at canvas sizes; narrow to
	// a `where id in (...)` if a canvas ever gets big enough to notice.
	const stored = await getBlocks(parent, tx);
	const known = new Set(stored.map((b) => b.id));
	for (const id of deleteBlockIds) known.delete(id);

	const missing = [...referenced].filter((id) => !known.has(id));
	if (missing.length > 0) {
		throw new BadRequestError(
			`Edge references unknown block(s): ${missing.join(", ")}`,
		);
	}
}

/**
 * The single source of truth for canvas mutations. Every caller — both HTTP
 * endpoints and the internal ops bus — goes through here, so a canvas is
 * changed exactly one way whatever it hangs off.
 *
 * Pass `outer` to join a transaction already in progress — that is how
 * "create the parent and its canvas or neither" is possible on the ops bus.
 * The change signal is then the outer caller's to publish, after it commits.
 */
export async function saveCanvas(
	parent: CanvasParent,
	data: CanvasChanges,
	projectIds: string[] = [],
	outer?: DbTransactionType,
) {
	if (!(await parentExists(parent, projectIds, outer))) {
		throw new NotFoundError(NOT_FOUND[parent.type]);
	}

	const keys = parentKeys(parent);
	const deleteBlockIds = data.actionsToPerform.blocks
		.filter((c) => c.action === "delete")
		.map((c) => c.id);
	const deleteEdgeIds = data.actionsToPerform.edges
		.filter((c) => c.action === "delete")
		.map((c) => c.id);

	// a tx nests as a savepoint, so the outer transaction still decides the outcome
	await (outer ?? db).transaction(async (tx) => {
		await assertEdgeTargetsExist(parent, data, deleteBlockIds, tx);
		await upsertBlocks(
			data.changes.blocks.map((block) => ({ ...block, ...keys })),
			tx,
		);
		await upsertEdges(
			data.changes.edges.map((edge) => ({ ...edge, ...keys })),
			tx,
		);
		await deleteBlocks(deleteBlockIds, tx);
		await deleteEdges(deleteEdgeIds, tx);

		const structural = await getBlocksCountByType(
			parent,
			[BlockTypes.entrypoint, BlockTypes.errorHandler],
			tx,
		);
		await touchParent(parent, tx);
		for (const block of structural) {
			if (block.count !== 1) {
				tx.rollback();
				throw new BadRequestError(`Duplicate block ${block.type} found`);
			}
		}
	});

	if (!outer) await publishMessage(CHANGE_CHANNEL[parent.type], parent.id);
}

export async function getCanvas(
	parent: CanvasParent,
	projectIds: string[] = [],
) {
	return await db.transaction(async (tx) => {
		if (!(await parentExists(parent, projectIds, tx))) {
			throw new NotFoundError(NOT_FOUND[parent.type]);
		}
		const [blocks, edges] = await Promise.all([
			getBlocks(parent, tx),
			getEdges(parent, tx),
		]);
		return {
			blocks: blocks.map((b) => ({
				id: b.id,
				type: b.type!,
				data: b.data as any,
				position: (b.position as { x: number; y: number }) ?? { x: 0, y: 0 },
			})),
			edges: edges.map((e) => ({
				id: e.id,
				from: e.from!,
				to: e.to!,
				fromHandle: e.fromHandle!,
				toHandle: e.toHandle!,
			})),
		};
	});
}
