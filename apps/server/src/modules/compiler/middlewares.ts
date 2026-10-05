import type { Middleware, RouteMiddlewares } from "@fluxify/blocks";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
	customBlocksListEntity,
	middlewareBlocksEntity,
	middlewaresEntity,
	routeMiddlewaresEntity,
} from "../../db/schema";
import type { RouteMiddlewareIds } from "./artifacts";

/** one middleware as it runs, or undefined once it is deleted */
export async function loadMiddleware(id: string) {
	const [row] = await db
		.select({ projectId: middlewaresEntity.projectId, name: middlewaresEntity.name })
		.from(middlewaresEntity)
		.where(eq(middlewaresEntity.id, id));
	if (!row) return undefined;
	const chain = await db
		.select({ name: customBlocksListEntity.name })
		.from(middlewareBlocksEntity)
		.innerJoin(
			customBlocksListEntity,
			eq(customBlocksListEntity.id, middlewareBlocksEntity.customBlockId),
		)
		.where(eq(middlewareBlocksEntity.middlewareId, id))
		.orderBy(asc(middlewareBlocksEntity.position));
	const middleware: Middleware = { id, name: row.name, blocks: chain.map((b) => b.name) };
	return { projectId: row.projectId, middleware };
}

/**
 * The ids of a route's middlewares (#534), per phase in route order. Every
 * attached one, even with an empty chain: its chain lives in its own artifact,
 * so blocks added later must reach this route without a rebuild.
 * Undefined when the route has none, so its artifact stays as it was.
 */
export async function loadRouteMiddlewareIds(
	routeId: string,
): Promise<RouteMiddlewareIds | undefined> {
	const rows = await db
		.select({ phase: routeMiddlewaresEntity.phase, id: routeMiddlewaresEntity.middlewareId })
		.from(routeMiddlewaresEntity)
		.where(eq(routeMiddlewaresEntity.routeId, routeId))
		.orderBy(asc(routeMiddlewaresEntity.position));
	if (rows.length === 0) return undefined;
	const ids: RouteMiddlewareIds = { before: [], after: [] };
	for (const { phase, id } of rows) ids[phase].push(id);
	return ids;
}

/** a route's middlewares resolved in full — the test runner, which reads the database */
export async function loadRouteMiddlewares(routeId: string): Promise<RouteMiddlewares | undefined> {
	const ids = await loadRouteMiddlewareIds(routeId);
	if (!ids) return undefined;
	const resolve = async (list: string[]) => {
		const loaded = await Promise.all(list.map(loadMiddleware));
		return loaded.flatMap((entry) => (entry ? [entry.middleware] : []));
	};
	return { before: await resolve(ids.before), after: await resolve(ids.after) };
}
