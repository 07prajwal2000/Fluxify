import { eq } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../db";
import { projectsEntity, routesEntity } from "../../../../db/schema";

export async function getRouteById(id: string, tx?: DbTransactionType) {
	const route = await (tx ?? db)
		.select({
			id: routesEntity.id,
			name: routesEntity.name,
			path: routesEntity.path,
			method: routesEntity.method,
			active: routesEntity.active,
			createdBy: routesEntity.createdBy,
			projectId: routesEntity.projectId,
			createdAt: routesEntity.createdAt,
			updatedAt: routesEntity.updatedAt,
			projectName: projectsEntity.name,
			bodySchema: routesEntity.bodySchema,
			querySchema: routesEntity.querySchema,
			paramsSchema: routesEntity.paramsSchema,
		})
		.from(routesEntity)
		.leftJoin(projectsEntity, eq(routesEntity.projectId, projectsEntity.id))
		.where(eq(routesEntity.id, id))
		.limit(1);
	return route.length > 0 ? route[0] : null;
}
