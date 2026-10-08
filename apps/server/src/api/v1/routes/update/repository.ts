import { and, eq, ne, or, type SQL, sql } from "drizzle-orm";
import { createUpdateSchema } from "drizzle-zod";
import type z from "zod";
import { type DbTransactionType, db } from "../../../../db";
import { type HttpMethod, routesEntity } from "../../../../db/schema";

const updateRouteSchema = createUpdateSchema(routesEntity);

export async function updateRoute(data: z.infer<typeof updateRouteSchema>, tx?: DbTransactionType) {
	const id = data.id!;
	delete data.id;
	const result = await (tx ?? db)
		.update(routesEntity)
		.set(data)
		.where(eq(routesEntity.id, id))
		.returning();
	return result.length > 0 ? result[0] : null;
}

export async function getRouteById(id: string, tx?: DbTransactionType) {
	const result = await (tx ?? db).select().from(routesEntity).where(eq(routesEntity.id, id));
	return result[0] ?? null;
}

/** `/users/:id/` and `/users/:userId` match the same requests: params become `:`, trailing `/` goes. */
const pathShape = (path: SQL | typeof routesEntity.path) =>
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
					),
				),
			),
		)
		.limit(1);
	return result[0];
}
