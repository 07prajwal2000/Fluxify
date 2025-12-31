import { and, count, desc, eq, ilike, SQL } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../../db";
import { accessControlEntity } from "../../../../../db/schema";
import { user } from "../../../../../db/auth-schema";

export async function listProjectMembers(
  projectId: string,
  skip: number,
  limit: number,
  filters?: { role?: string; name?: string },
  tx?: DbTransactionType
) {
  // Build conditions array dynamically
  const conditions = [eq(accessControlEntity.projectId, projectId)];

  if (filters?.role) {
    conditions.push(eq(accessControlEntity.role, filters.role as any));
  }

  if (filters?.name) {
    conditions.push(ilike(user.name, `%${filters.name}%`));
  }

  const where = and(...conditions);

  const result = await (tx ?? db)
    .select({
      id: user.id,
      name: user.name,
      userId: user.id,
      role: accessControlEntity.role,
      createdAt: accessControlEntity.createdAt,
      updatedAt: accessControlEntity.updatedAt,
    })
    .from(accessControlEntity)
    .leftJoin(user, eq(accessControlEntity.userId, user.id))
    .where(where)
    .orderBy(desc(accessControlEntity.updatedAt))
    .offset(skip)
    .limit(limit);

  const [{ count: totalCount }] = await (tx ?? db)
    .select({ count: count(accessControlEntity.id) })
    .from(accessControlEntity)
    .leftJoin(user, eq(accessControlEntity.userId, user.id))
    .where(where);

  return { result, totalCount };
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: string,
  tx?: DbTransactionType
) {
  const res = await (tx ?? db)
    .insert(accessControlEntity)
    .values({ projectId, userId, role: role as any })
    .returning();
  return res[0];
}

export async function projectMemberExists(
  projectId: string,
  userId: string,
  tx?: DbTransactionType
) {
  const res = await (tx ?? db)
    .select({ count: count(accessControlEntity.id) })
    .from(accessControlEntity)
    .where(
      and(
        eq(accessControlEntity.projectId, projectId),
        eq(accessControlEntity.userId, userId)
      )
    );
  return res[0].count > 0;
}

export async function updateProjectMemberRole(
  projectId: string,
  userId: string,
  role: string,
  tx?: DbTransactionType
) {
  const res = await (tx ?? db)
    .update(accessControlEntity)
    .set({ role: role as any })
    .where(
      and(
        eq(accessControlEntity.projectId, projectId),
        eq(accessControlEntity.userId, userId)
      )
    )
    .returning();
  return res[0];
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
  tx?: DbTransactionType
) {
  const res = await (tx ?? db)
    .delete(accessControlEntity)
    .where(
      and(
        eq(accessControlEntity.projectId, projectId),
        eq(accessControlEntity.userId, userId)
      )
    )
    .returning();
  return res[0];
}
