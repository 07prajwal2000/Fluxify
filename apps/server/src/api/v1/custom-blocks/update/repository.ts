import { db, DbTransactionType } from "../../../../db";
import { customBlocksListEntity } from "../../../../db/schema";
import { eq, and } from "drizzle-orm";
import { createUpdateSchema } from "drizzle-zod";
import z from "zod";

const updateSchema = createUpdateSchema(customBlocksListEntity).omit({ id: true, projectId: true, name: true });

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
  data: z.infer<typeof updateSchema>,
  tx?: DbTransactionType
) {
  const updated = await (tx ?? db)
    .update(customBlocksListEntity)
    .set(data)
    .where(eq(customBlocksListEntity.id, id))
    .returning();
  return updated[0];
}
