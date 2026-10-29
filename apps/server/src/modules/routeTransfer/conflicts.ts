import { and, eq, sql } from "drizzle-orm";
import { pathShape } from "../../api/v1/routes/update/repository";
import { db } from "../../db";
import { routesEntity } from "../../db/schema";

/**
 * What a route about to be imported would collide with in `projectId`. The same
 * two rules as the import itself: a name is unique in the project, and so is a
 * method on a path the router cannot tell apart. Other projects never count.
 */
export async function importConflicts(
	projectId: string,
	route: { name: string; path: string; method: string },
) {
	const inProject = eq(routesEntity.projectId, projectId);
	const [named] = await db
		.select({ id: routesEntity.id })
		.from(routesEntity)
		.where(and(inProject, eq(routesEntity.name, route.name)))
		.limit(1);
	const [pathed] = await db
		.select({ id: routesEntity.id })
		.from(routesEntity)
		.where(
			and(
				inProject,
				eq(routesEntity.method, route.method),
				sql`${pathShape(routesEntity.path)} = ${pathShape(sql`${route.path}`)}`,
			),
		)
		.limit(1);
	return { nameTaken: !!named, pathTaken: !!pathed };
}
