import { and, eq, ne, or, type SQL, sql } from "drizzle-orm";
import { createUpdateSchema } from "drizzle-zod";
import type z from "zod";
import { type DbTransactionType, db } from "../../../../db";
import { canvasVersionsEntity, type HttpMethod, routesEntity } from "../../../../db/schema";
import {
	ROUTE_VERSIONED_FIELDS,
	versionedSettingsChanged,
} from "../../../../modules/versions/state";

const updateRouteSchema = createUpdateSchema(routesEntity);

/**
 * Every route settings save lands here. Changing a setting a version keeps
 * (#738) moves the revision like a canvas edit does, so the route reads as
 * having uncommitted changes; name, switches and observability do not.
 *
 * The counters a canvas save owns, and the versions commit, checkout and promote
 * own, are never taken from the caller: a patch that sends back the row it read
 * would otherwise undo a save, a commit or a promote made in between.
 */
export async function updateRoute(data: z.infer<typeof updateRouteSchema>, tx?: DbTransactionType) {
	const {
		id,
		canvasRevision: _revision,
		blockKeyCounters: _keys,
		committedRevision: _committed,
		headVersionId: _head,
		prodVersionId: _prod,
		...settings
	} = data;
	const conn = tx ?? db;
	const [stored] = await conn
		.select()
		.from(routesEntity)
		.where(eq(routesEntity.id, id!))
		.for("update");
	const bump = !!stored && versionedSettingsChanged(stored, settings, ROUTE_VERSIONED_FIELDS);
	const result = await conn
		.update(routesEntity)
		.set(bump ? { ...settings, canvasRevision: sql`${routesEntity.canvasRevision} + 1` } : settings)
		.where(eq(routesEntity.id, id!))
		.returning();
	return result.length > 0 ? result[0] : null;
}

export async function getRouteById(id: string, tx?: DbTransactionType) {
	const result = await (tx ?? db).select().from(routesEntity).where(eq(routesEntity.id, id));
	return result[0] ?? null;
}

/** `/users/:id/` and `/users/:userId` match the same requests: params become `:`, trailing `/` goes. */
export const pathShape = (path: SQL | typeof routesEntity.path) =>
	sql`rtrim(regexp_replace(${path}, ':[A-Za-z0-9_]+', ':', 'g'), '/')`;

export type RouteConflict = {
	id: string;
	name: string | null;
	path: string | null;
	method: string | null;
	projectId: string | null;
};

/**
 * The route a new or edited route would clash with, if any: the same name in
 * the same project, or the same method on a path the request router cannot
 * tell apart. Other methods on the same path never clash. Paths are compared
 * across projects because projects without a subdomain share one router.
 */
export async function findRouteConflict(
	route: { projectId: string; name: string; path: string; method: HttpMethod | string },
	excludeId?: string,
	tx?: DbTransactionType,
	/** an import into another project only clashes with that project's own routes */
	sameProjectOnly = false,
): Promise<RouteConflict | undefined> {
	const result = await (tx ?? db)
		.select({
			id: routesEntity.id,
			name: routesEntity.name,
			path: routesEntity.path,
			method: routesEntity.method,
			projectId: routesEntity.projectId,
		})
		.from(routesEntity)
		.where(
			and(
				excludeId ? ne(routesEntity.id, excludeId) : undefined,
				or(
					and(eq(routesEntity.projectId, route.projectId), eq(routesEntity.name, route.name)),
					and(
						eq(routesEntity.method, route.method),
						sql`${pathShape(routesEntity.path)} = ${pathShape(sql`${route.path}`)}`,
						sameProjectOnly ? eq(routesEntity.projectId, route.projectId) : undefined,
					),
				),
			),
		)
		.limit(1);
	return result[0];
}

/**
 * The route whose promoted version holds the same method on a path the router
 * cannot tell apart from this one (#739). Two versions can share a path while
 * only one of them is live; the clash is between what production would serve.
 * Compared across projects, like `findRouteConflict`.
 */
export async function findProdPathClash(
	route: { id: string; method: string; path: string },
	tx?: DbTransactionType,
) {
	// the keys are constants, spelled out: a bound parameter has no type after `->>`
	const settings = (field: "path" | "method") =>
		sql`${canvasVersionsEntity.snapshot}->'settings'->>${sql.raw(`'${field}'`)}`;
	const [clash] = await (tx ?? db)
		.select({
			id: routesEntity.id,
			name: routesEntity.name,
			projectId: routesEntity.projectId,
			path: sql<string>`${settings("path")}`,
			method: sql<string>`${settings("method")}`,
		})
		.from(routesEntity)
		.innerJoin(canvasVersionsEntity, eq(canvasVersionsEntity.id, routesEntity.prodVersionId))
		.where(
			and(
				ne(routesEntity.id, route.id),
				sql`${settings("method")} = ${route.method}`,
				sql`${pathShape(settings("path"))} = ${pathShape(sql`${route.path}`)}`,
			),
		)
		.limit(1);
	return clash;
}
