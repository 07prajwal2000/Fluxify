import { and, asc, count, eq, inArray } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../db";
import { CHAN_ON_ROUTE_CHANGE, publishMessage } from "../../../db/redis";
import {
	customBlocksListEntity,
	type MiddlewarePhase,
	middlewareBlocksEntity,
	middlewaresEntity,
	routeMiddlewaresEntity,
	routesEntity,
} from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { ConflictError } from "../../../errors/conflictError";

/**
 * Queries shared by the middleware endpoints (#534) and the route's own
 * middleware endpoints — one table set, so one place that reads and writes it.
 */

export async function getMiddleware(id: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select()
		.from(middlewaresEntity)
		.where(eq(middlewaresEntity.id, id));
	return row;
}

export async function listMiddlewares(projectId: string) {
	return await db
		.select({
			id: middlewaresEntity.id,
			name: middlewaresEntity.name,
			description: middlewaresEntity.description,
			updatedAt: middlewaresEntity.updatedAt,
		})
		.from(middlewaresEntity)
		.where(eq(middlewaresEntity.projectId, projectId))
		.orderBy(asc(middlewaresEntity.name));
}

/** every chain in the project, in run order: one query for the whole list page */
export async function listChains(projectId: string) {
	return await db
		.select({
			middlewareId: middlewareBlocksEntity.middlewareId,
			id: customBlocksListEntity.id,
			name: customBlocksListEntity.name,
			label: customBlocksListEntity.label,
			description: customBlocksListEntity.description,
			icon: customBlocksListEntity.icon,
			iconUrl: customBlocksListEntity.iconUrl,
		})
		.from(middlewareBlocksEntity)
		.innerJoin(middlewaresEntity, eq(middlewaresEntity.id, middlewareBlocksEntity.middlewareId))
		.innerJoin(
			customBlocksListEntity,
			eq(customBlocksListEntity.id, middlewareBlocksEntity.customBlockId),
		)
		.where(eq(middlewaresEntity.projectId, projectId))
		.orderBy(asc(middlewareBlocksEntity.position));
}

/** how many routes attach each middleware of the project */
export async function routeCounts(projectId: string) {
	return await db
		.select({ middlewareId: routeMiddlewaresEntity.middlewareId, count: count() })
		.from(routeMiddlewaresEntity)
		.innerJoin(middlewaresEntity, eq(middlewaresEntity.id, routeMiddlewaresEntity.middlewareId))
		.where(eq(middlewaresEntity.projectId, projectId))
		.groupBy(routeMiddlewaresEntity.middlewareId);
}

/** a middleware's chain, in run order */
export async function getChain(middlewareId: string) {
	return await db
		.select({
			id: customBlocksListEntity.id,
			name: customBlocksListEntity.name,
			label: customBlocksListEntity.label,
			description: customBlocksListEntity.description,
			icon: customBlocksListEntity.icon,
			iconUrl: customBlocksListEntity.iconUrl,
		})
		.from(middlewareBlocksEntity)
		.innerJoin(
			customBlocksListEntity,
			eq(customBlocksListEntity.id, middlewareBlocksEntity.customBlockId),
		)
		.where(eq(middlewareBlocksEntity.middlewareId, middlewareId))
		.orderBy(asc(middlewareBlocksEntity.position));
}

/** replace the whole chain: a reorder is just a save of the new order */
export async function setChain(
	middlewareId: string,
	projectId: string,
	blockIds: string[],
	tx: DbTransactionType,
) {
	if (blockIds.length) {
		const valid = await tx
			.select({ id: customBlocksListEntity.id })
			.from(customBlocksListEntity)
			.where(
				and(
					inArray(customBlocksListEntity.id, blockIds),
					eq(customBlocksListEntity.projectId, projectId),
					eq(customBlocksListEntity.usage, "middleware"),
				),
			);
		if (valid.length !== blockIds.length) {
			throw new BadRequestError("Only this project's middleware custom blocks can be chained");
		}
	}
	await tx
		.delete(middlewareBlocksEntity)
		.where(eq(middlewareBlocksEntity.middlewareId, middlewareId));
	if (blockIds.length) {
		await tx
			.insert(middlewareBlocksEntity)
			.values(
				blockIds.map((customBlockId, position) => ({ middlewareId, customBlockId, position })),
			);
	}
}

export async function nameTaken(
	projectId: string,
	name: string,
	exceptId: string | undefined,
	tx: DbTransactionType,
) {
	const [row] = await tx
		.select({ id: middlewaresEntity.id })
		.from(middlewaresEntity)
		.where(and(eq(middlewaresEntity.projectId, projectId), eq(middlewaresEntity.name, name)));
	if (row && row.id !== exceptId) {
		throw new ConflictError(`A middleware named "${name}" already exists in this project`);
	}
}

/** routes that attach the middleware — what must recompile when it changes */
export async function routesUsing(middlewareId: string, tx?: DbTransactionType) {
	const rows = await (tx ?? db)
		.select({ routeId: routeMiddlewaresEntity.routeId })
		.from(routeMiddlewaresEntity)
		.where(eq(routeMiddlewaresEntity.middlewareId, middlewareId));
	return rows.map((r) => r.routeId);
}

/** the route artifact carries its middlewares, so every change is a recompile */
export async function recompileRoutes(routeIds: string[]) {
	await Promise.all(routeIds.map((id) => publishMessage(CHAN_ON_ROUTE_CHANGE, id)));
}

export async function getRouteProject(routeId: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select({ projectId: routesEntity.projectId })
		.from(routesEntity)
		.where(eq(routesEntity.id, routeId));
	return row?.projectId ?? undefined;
}

export async function getRouteMiddlewares(routeId: string) {
	return await db
		.select({
			id: middlewaresEntity.id,
			name: middlewaresEntity.name,
			description: middlewaresEntity.description,
			phase: routeMiddlewaresEntity.phase,
		})
		.from(routeMiddlewaresEntity)
		.innerJoin(middlewaresEntity, eq(middlewaresEntity.id, routeMiddlewaresEntity.middlewareId))
		.where(eq(routeMiddlewaresEntity.routeId, routeId))
		.orderBy(asc(routeMiddlewaresEntity.position));
}

/** replace a route's middlewares; each one appears once, in one phase */
export async function setRouteMiddlewares(
	routeId: string,
	projectId: string,
	phases: Record<MiddlewarePhase, string[]>,
	tx: DbTransactionType,
) {
	const all = [...phases.before, ...phases.after];
	if (new Set(all).size !== all.length) {
		throw new BadRequestError("A middleware can be added to a route only once");
	}
	if (all.length) {
		const valid = await tx
			.select({ id: middlewaresEntity.id })
			.from(middlewaresEntity)
			.where(and(inArray(middlewaresEntity.id, all), eq(middlewaresEntity.projectId, projectId)));
		if (valid.length !== all.length) {
			throw new BadRequestError("Only this project's middlewares can be added to its routes");
		}
	}
	await tx.delete(routeMiddlewaresEntity).where(eq(routeMiddlewaresEntity.routeId, routeId));
	const rows = (["before", "after"] as const).flatMap((phase) =>
		phases[phase].map((middlewareId, position) => ({ routeId, middlewareId, phase, position })),
	);
	if (rows.length) await tx.insert(routeMiddlewaresEntity).values(rows);
}
