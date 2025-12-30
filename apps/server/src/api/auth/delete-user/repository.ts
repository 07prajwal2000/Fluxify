import { db, DbTransactionType } from "../../../db";
import { user } from "../../../db/auth-schema";
import { eq } from "drizzle-orm";

export async function deleteUser(userId: string, tx?: DbTransactionType) {
  await (tx ?? db).delete(user).where(eq(user.id, userId));
}

export async function getUserRole(userId: string, tx?: DbTransactionType) {
  const result = await (tx ?? db)
    .select({
      role: user.role,
    })
    .from(user)
    .where(eq(user.id, userId));

  return result[0];
}
