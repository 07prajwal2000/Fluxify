import { db, DbTransactionType } from "../../../../db";
import { customBlocksListEntity } from "../../../../db/schema";
import { eq, and } from "drizzle-orm";

type UpdateCustomBlockData = Partial<
  Omit<typeof customBlocksListEntity.$inferInsert, "id" | "projectId" | "name">
>;

export async function getCustomBlockById(id: string, tx?: DbTransactionType) {
  const block = await (tx ?? db)
    .select()
    .from(customBlocksListEntity)
    .where(eq(customBlocksListEntity.id, id))
    .limit(1);
  return block[0];
}

// Removed checkCustomBlockNameExist since name is immutable

export async function updateCustomBlock(
  id: string,
  data: UpdateCustomBlockData,
  tx?: DbTransactionType
) {
  const updated = await (tx ?? db)
    .update(customBlocksListEntity)
    .set(data)
    .where(eq(customBlocksListEntity.id, id))
    .returning();
  return updated[0];
}
