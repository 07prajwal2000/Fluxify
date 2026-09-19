import { count, desc, eq, type SQL } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { projectsEntity, routesEntity } from "../../../../db/schema";

export async function getRoutesList(
	skip: number,
	limit: number,
	filter?: SQL<unknown>,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
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
		})
		.from(routesEntity)
		.leftJoin(projectsEntity, eq(routesEntity.projectId, projectsEntity.id))
		.where(filter)
		.offset(skip)
		.orderBy(desc(routesEntity.updatedAt))
		.limit(limit);
	const totalCount = await getRoutesCount(filter, tx);
	return { result, totalCount };
}

async function getRoutesCount(filter?: SQL<unknown>, tx?: DbTransactionType) {
	const totalCount = await (tx ?? db)
		.select({
			count: count(routesEntity.id),
		})
		.from(routesEntity)
		.where(filter);
	return totalCount[0].count;
}
