import type { RouteMiddlewares } from "@fluxify/blocks";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
	customBlocksListEntity,
	middlewareBlocksEntity,
	routeMiddlewaresEntity,
} from "../../db/schema";

/**
 * A route's middlewares (#534), flattened into the steps each phase runs: every
 * attached middleware in route order, and each one's chain in its own order.
 * Undefined when the route has none, so its artifact stays as it was.
 */
export async function loadRouteMiddlewares(routeId: string): Promise<RouteMiddlewares | undefined> {
	const rows = await db
		.select({
			phase: routeMiddlewaresEntity.phase,
			middlewareId: routeMiddlewaresEntity.middlewareId,
			block: customBlocksListEntity.name,
		})
		.from(routeMiddlewaresEntity)
		.innerJoin(
			middlewareBlocksEntity,
			eq(middlewareBlocksEntity.middlewareId, routeMiddlewaresEntity.middlewareId),
		)
		.innerJoin(
			customBlocksListEntity,
			eq(customBlocksListEntity.id, middlewareBlocksEntity.customBlockId),
		)
		.where(eq(routeMiddlewaresEntity.routeId, routeId))
		.orderBy(asc(routeMiddlewaresEntity.position), asc(middlewareBlocksEntity.position));
	if (rows.length === 0) return undefined;
	const middlewares: RouteMiddlewares = { before: [], after: [] };
	for (const { phase, middlewareId, block } of rows) {
		middlewares[phase].push({ middlewareId, block });
	}
	return middlewares;
}
