import { db, DbTransactionType } from "../../../db";
import { user } from "../../../db/auth-schema";
import { eq } from "drizzle-orm";

export async function updateUser(
  userId: string,
  data: { isSystemAdmin: boolean },
  tx?: DbTransactionType
) {
  await (tx ?? db)
    .update(user)
    .set({
      isSystemAdmin: data.isSystemAdmin,
    })
    .where(eq(user.id, userId));
}
