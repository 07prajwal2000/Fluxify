import { and, count, desc, eq, inArray, ne, or } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../db";
import { projectsEntity } from "../../../../db/schema";

export async function getProjectsList(
  skip: number,
  limit: number,
  projectsList: string[] = [],
  tx?: DbTransactionType
) {
  const isSystemAdmin = projectsList.some((id) => id === "*");
  const result = await (tx ?? db)
    .select()
    .from(projectsEntity)
    .where(
      and(
        eq(projectsEntity.hidden, false),
        isSystemAdmin ? undefined : inArray(projectsEntity.id, projectsList)
      )
    )
    .orderBy(desc(projectsEntity.updatedAt))
    .offset(skip)
    .limit(limit);
  const totalCount = await getTotalCount();
  return {
    data: result,
    totalCount,
  };
}

export async function getTotalCount() {
  const result = await db
    .select({ count: count(projectsEntity.id) })
    .from(projectsEntity)
    .where(eq(projectsEntity.hidden, false));
  return result[0].count;
}
