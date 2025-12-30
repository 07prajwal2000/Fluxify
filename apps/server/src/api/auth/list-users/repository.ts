import { db, DbTransactionType } from "../../../db";
import { user } from "../../../db/auth-schema";
import { desc, sql } from "drizzle-orm";

export async function getUsers(
  skip: number,
  limit: number,
  tx?: DbTransactionType
) {
  const users = await (tx ?? db)
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isSystemAdmin: user.isSystemAdmin,
      role: user.role,
    })
    .from(user)
    .limit(limit)
    .offset(skip)
    .orderBy(desc(user.createdAt));
  return users;
}

export async function getUsersCount(tx?: DbTransactionType) {
  const count = await (tx ?? db)
    .select({
      count: sql<number>`count(*)`,
    })
    .from(user);
  return count[0].count;
}
