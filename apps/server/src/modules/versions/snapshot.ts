import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbTransactionType } from "../../db";
import {
	type CanvasSnapshot,
	type CanvasVersionKind,
	type CustomBlockSnapshot,
	customBlocksListEntity,
	type MiddlewareSnapshot,
	middlewareBlocksEntity,
	middlewaresEntity,
	routeMiddlewaresEntity,
	routesEntity,
	type VersionSnapshot,
	workflowsEntity,
} from "../../db/schema";
import {
	deleteEdges,
	deleteStructuralBlocks,
	getBlocks,
	getEdges,
	parentKeys,
	parentTable,
	upsertBlocks,
	upsertEdges,
} from "../canvas/repository";
import { listResponseSchemas, replaceResponseSchemas } from "../responseSchemas/repository";

/**
 * A version's content, in and out of the working copy (#738). Both directions
 * go through the canvas repository, so a restored canvas is stored exactly as
 * a saved one is. A middleware has no canvas: its version is its chain (#740).
 */

/** The working copy as a snapshot: what a commit stores. */
export async function buildSnapshot(
	kind: CanvasVersionKind,
	id: string,
	tx: DbTransactionType,
): Promise<VersionSnapshot> {
	if (kind === "middleware")
		return { blocks: [], edges: [], settings: { chain: await chainIds(id, tx) } };
	const parent = { type: kind, id } as const;
	const [blocks, edges] = await Promise.all([getBlocks(parent, tx), getEdges(parent, tx)]);
	return {
		blocks: blocks.map((b) => ({
			id: b.id,
			key: b.key,
			type: b.type!,
			data: b.data,
			position: (b.position as { x: number; y: number }) ?? { x: 0, y: 0 },
		})),
		edges: edges.map((e) => ({
			id: e.id,
			from: e.from!,
			to: e.to!,
			fromHandle: e.fromHandle,
			toHandle: e.toHandle,
		})),
		settings: await readSettings(kind, id, tx),
	} as VersionSnapshot;
}

/** A middleware's chain: the ids of its custom blocks, in run order. */
export async function chainIds(middlewareId: string, tx: DbTransactionType) {
	const rows = await tx
		.select({ id: middlewareBlocksEntity.customBlockId })
		.from(middlewareBlocksEntity)
		.where(eq(middlewareBlocksEntity.middlewareId, middlewareId))
		.orderBy(asc(middlewareBlocksEntity.position));
	return rows.map((row) => row.id);
}

async function readSettings(kind: CanvasVersionKind, id: string, tx: DbTransactionType) {
	if (kind === "custom_block") {
		const [row] = await tx
			.select({
				inputParams: customBlocksListEntity.inputParams,
				usage: customBlocksListEntity.usage,
			})
			.from(customBlocksListEntity)
			.where(eq(customBlocksListEntity.id, id));
		return { inputParams: row!.inputParams ?? null, usage: row!.usage };
	}
	if (kind === "workflow") {
		const [row] = await tx
			.select({ timeoutSeconds: workflowsEntity.timeoutSeconds })
			.from(workflowsEntity)
			.where(eq(workflowsEntity.id, id));
		return { timeoutSeconds: row!.timeoutSeconds };
	}
	const [row] = await tx
		.select({
			path: routesEntity.path,
			method: routesEntity.method,
			bodySchema: routesEntity.bodySchema,
			querySchema: routesEntity.querySchema,
			paramsSchema: routesEntity.paramsSchema,
			timeoutSeconds: routesEntity.timeoutSeconds,
		})
		.from(routesEntity)
		.where(eq(routesEntity.id, id));
	return {
		...row!,
		middlewares: await routeMiddlewareIds(id, tx),
		responseSchemas: (await listResponseSchemas(id, tx)).map(({ statusCode, schema }) => ({
			statusCode,
			schema,
		})),
	};
}

/** A route's middleware ids per phase, in run order. */
export async function routeMiddlewareIds(routeId: string, tx: DbTransactionType) {
	const rows = await tx
		.select({ id: routeMiddlewaresEntity.middlewareId, phase: routeMiddlewaresEntity.phase })
		.from(routeMiddlewaresEntity)
		.where(eq(routeMiddlewaresEntity.routeId, routeId))
		.orderBy(asc(routeMiddlewaresEntity.position));
	const ids = (phase: string) => rows.filter((r) => r.phase === phase).map((r) => r.id);
	return { before: ids("before"), after: ids("after") };
}

/** The number at the end of a block key, with the prefix it counts for. */
const keyParts = (key: string) => {
	const match = /^(.+)_(\d+)$/.exec(key);
	return match ? ([match[1]!, Number(match[2])] as const) : undefined;
};

/**
 * Replaces the working copy's blocks, edges and versioned settings with the
 * snapshot's. Blocks keep the ids and keys they had when it was taken. The
 * caller holds the row lock and moves the revision.
 *
 * Returns what could not be put back: a middleware (or, for a middleware's own
 * chain, a custom block) deleted since the commit.
 */
export async function restoreSnapshot(
	kind: CanvasVersionKind,
	target: { id: string; projectId: string | null },
	snapshot: VersionSnapshot,
	tx: DbTransactionType,
) {
	if (kind === "middleware") {
		return await restoreChain(target, (snapshot as MiddlewareSnapshot).settings.chain, tx);
	}
	const parent = { type: kind, id: target.id } as const;
	const keys = parentKeys(parent);

	// edges first, then the blocks the snapshot lacks, then the snapshot's own
	const [blocks, edges] = await Promise.all([getBlocks(parent, tx), getEdges(parent, tx)]);
	await deleteEdges(
		edges.map((e) => e.id),
		tx,
	);
	const wanted = new Set(snapshot.blocks.map((b) => b.id));
	await deleteStructuralBlocks(
		blocks.filter((b) => !wanted.has(b.id)).map((b) => b.id),
		tx,
	);
	await upsertBlocks(
		snapshot.blocks.map((b) => ({ ...b, ...keys })),
		tx,
	);
	await upsertEdges(
		snapshot.edges.map((e) => ({ ...e, ...keys })),
		tx,
	);
	await raiseKeyCounters(parent, snapshot, tx);

	return await restoreSettings(kind, target, snapshot.settings, tx);
}

/** The chain as it was, minus any block deleted or no longer a middleware block since. */
async function restoreChain(
	target: { id: string; projectId: string | null },
	chain: string[],
	tx: DbTransactionType,
) {
	const alive = new Set(
		chain.length
			? (
					await tx
						.select({ id: customBlocksListEntity.id })
						.from(customBlocksListEntity)
						.where(
							and(
								inArray(customBlocksListEntity.id, chain),
								eq(customBlocksListEntity.projectId, target.projectId!),
								eq(customBlocksListEntity.usage, "middleware"),
							),
						)
				).map((r) => r.id)
			: [],
	);
	await tx.delete(middlewareBlocksEntity).where(eq(middlewareBlocksEntity.middlewareId, target.id));
	const rows = chain
		.filter((id) => alive.has(id))
		.map((customBlockId, position) => ({ middlewareId: target.id, customBlockId, position }));
	if (rows.length) await tx.insert(middlewareBlocksEntity).values(rows);
	return chain.filter((id) => !alive.has(id));
}

/** Counters only ever go up: a key in the snapshot is never handed out twice. */
async function raiseKeyCounters(
	parent: { type: Exclude<CanvasVersionKind, "middleware">; id: string },
	snapshot: VersionSnapshot,
	tx: DbTransactionType,
) {
	const table = parentTable(parent.type);
	const [row] = await tx
		.select({ counters: table.blockKeyCounters })
		.from(table)
		.where(eq(table.id, parent.id));
	const counters: Record<string, number> = { ...(row?.counters ?? {}) };
	let raised = false;
	for (const block of snapshot.blocks) {
		const [prefix, n] = keyParts(block.key) ?? [];
		if (prefix && n !== undefined && n > (counters[prefix] ?? 0)) {
			counters[prefix] = n;
			raised = true;
		}
	}
	if (raised)
		await tx.update(table).set({ blockKeyCounters: counters }).where(eq(table.id, parent.id));
}

async function restoreSettings(
	kind: CanvasVersionKind,
	target: { id: string; projectId: string | null },
	versioned: VersionSnapshot["settings"],
	tx: DbTransactionType,
) {
	if (kind === "custom_block") {
		const { inputParams, usage } = versioned as CustomBlockSnapshot["settings"];
		await tx
			.update(customBlocksListEntity)
			.set({ inputParams, usage })
			.where(eq(customBlocksListEntity.id, target.id));
		return [];
	}
	const settings = versioned as CanvasSnapshot["settings"];
	if (kind === "workflow") {
		await tx
			.update(workflowsEntity)
			.set({ timeoutSeconds: settings.timeoutSeconds })
			.where(eq(workflowsEntity.id, target.id));
		return [];
	}
	await tx
		.update(routesEntity)
		.set({
			path: settings.path,
			method: settings.method,
			bodySchema: settings.bodySchema ?? null,
			querySchema: settings.querySchema ?? null,
			paramsSchema: settings.paramsSchema ?? null,
			timeoutSeconds: settings.timeoutSeconds,
		})
		.where(eq(routesEntity.id, target.id));

	// a version from before response schemas existed has none to put back: leave the working copy's alone
	if (settings.responseSchemas) {
		await replaceResponseSchemas(target.id, settings.responseSchemas, tx);
	}

	// a middleware deleted since is skipped, not an error: nothing can attach it again
	const before = settings.middlewares?.before ?? [];
	const after = settings.middlewares?.after ?? [];
	const all = [...before, ...after];
	const alive = new Set(
		all.length
			? (
					await tx
						.select({ id: middlewaresEntity.id })
						.from(middlewaresEntity)
						.where(
							and(
								inArray(middlewaresEntity.id, all),
								eq(middlewaresEntity.projectId, target.projectId!),
							),
						)
				).map((r) => r.id)
			: [],
	);
	await tx.delete(routeMiddlewaresEntity).where(eq(routeMiddlewaresEntity.routeId, target.id));
	const rows = (["before", "after"] as const).flatMap((phase) =>
		(phase === "before" ? before : after)
			.filter((id) => alive.has(id))
			.map((middlewareId, position) => ({ routeId: target.id, middlewareId, phase, position })),
	);
	if (rows.length) await tx.insert(routeMiddlewaresEntity).values(rows);
	return all.filter((id) => !alive.has(id));
}
