import type { Middleware, RouteMiddlewares } from "@fluxify/blocks";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
	customBlocksListEntity,
	type MiddlewareSnapshot,
	middlewareBlocksEntity,
	middlewaresEntity,
	routeMiddlewaresEntity,
	type VersionSnapshot,
} from "../../db/schema";
import { readSnapshot } from "../versions/repository";
import type { RouteMiddlewareIds } from "./artifacts";

/**
 * One custom block or middleware standing in for its promoted version (#740): a
 * promote's tests gate runs the users with the candidate in its place.
 */
export type LibrarySwap = {
	kind: "custom_block" | "middleware";
	id: string;
	snapshot: VersionSnapshot;
};

/** the names of custom blocks, in the order asked; one that is gone is left out */
async function blockNames(ids: string[]) {
	if (!ids.length) return [];
	const rows = await db
		.select({ id: customBlocksListEntity.id, name: customBlocksListEntity.name })
		.from(customBlocksListEntity)
		.where(inArray(customBlocksListEntity.id, ids));
	const byId = new Map(rows.map((row) => [row.id, row.name]));
	return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/**
 * A middleware as production runs it: the chain of its promoted version, or of
 * `swap` while a promote is being checked. Undefined for one that is deleted or
 * has no promoted version, which production does not serve.
 */
export async function loadProdMiddleware(id: string, swap?: LibrarySwap) {
	const [row] = await db
		.select({
			projectId: middlewaresEntity.projectId,
			name: middlewaresEntity.name,
			prodVersionId: middlewaresEntity.prodVersionId,
		})
		.from(middlewaresEntity)
		.where(eq(middlewaresEntity.id, id));
	if (!row) return undefined;
	const snapshot =
		swap?.kind === "middleware" && swap.id === id
			? (swap.snapshot as MiddlewareSnapshot)
			: row.prodVersionId
				? await readSnapshot<MiddlewareSnapshot>(row.prodVersionId)
				: undefined;
	if (!snapshot) return undefined;
	const middleware: Middleware = {
		id,
		name: row.name,
		blocks: await blockNames(snapshot.settings.chain),
	};
	return { projectId: row.projectId, middleware };
}

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
	return resolveMiddlewareIds(await loadRouteMiddlewareIds(routeId));
}

/**
 * The same for ids already known, such as a version's snapshot (#739). A
 * `production` resolve reads each middleware's promoted chain, with `swap` in
 * place of the one being promoted (#740); otherwise it reads the working copy.
 */
export async function resolveMiddlewareIds(
	ids: RouteMiddlewareIds | undefined,
	as: { production: true; swap?: LibrarySwap } | { production?: false } = {},
): Promise<RouteMiddlewares | undefined> {
	if (!ids || (!ids.before.length && !ids.after.length)) return undefined;
	const load = as.production
		? (id: string) => loadProdMiddleware(id, as.swap)
		: (id: string) => loadMiddleware(id);
	const resolve = async (list: string[]) => {
		const loaded = await Promise.all(list.map(load));
		return loaded.flatMap((entry) => (entry ? [entry.middleware] : []));
	};
	return { before: await resolve(ids.before), after: await resolve(ids.after) };
}
