import { and, count, countDistinct, desc, eq, inArray } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../db";
import {
  accessControlEntity,
  projectsEntity,
  routesEntity,
} from "../../../../db/schema";

export async function getProjectsList(
  skip: number,
  limit: number,
  projectsList: string[] = [],
  tx?: DbTransactionType
) {
  const isSystemAdmin = projectsList.some((id) => id === "*");
  const where = and(
    eq(projectsEntity.hidden, false),
    isSystemAdmin ? undefined : inArray(projectsEntity.id, projectsList)
  );
  const result = await (tx ?? db)
    .select({
      id: projectsEntity.id,
      name: projectsEntity.name,
      description: projectsEntity.description,
      createdAt: projectsEntity.createdAt,
      hidden: projectsEntity.hidden,
      updatedAt: projectsEntity.updatedAt,
      totalUsers: countDistinct(accessControlEntity.userId),
      totalRoutes: countDistinct(routesEntity.id),
    })
    .from(projectsEntity)
    .leftJoin(
      accessControlEntity,
      eq(accessControlEntity.projectId, projectsEntity.id)
    )
    .leftJoin(routesEntity, eq(routesEntity.projectId, projectsEntity.id))
    .where(where)
    .groupBy(
      projectsEntity.id,
      projectsEntity.name,
      projectsEntity.description,
      projectsEntity.createdAt,
      projectsEntity.hidden,
      projectsEntity.updatedAt
    )
    .orderBy(desc(projectsEntity.updatedAt))
    .offset(skip)
    .limit(limit);
  const totalCount = await getTotalCount(projectsList, isSystemAdmin, tx);
  return {
    data: result,
    totalCount,
  };
}

export async function getTotalCount(
  projectsList: string[] = [],
  isSystemAdmin = projectsList.some((id) => id === "*"),
  tx?: DbTransactionType
) {
  const result = await (tx ?? db)
    .select({ count: count(projectsEntity.id) })
    .from(projectsEntity)
    .where(
      and(
        eq(projectsEntity.hidden, false),
        isSystemAdmin ? undefined : inArray(projectsEntity.id, projectsList)
      )
    );
  return result[0].count;
}
