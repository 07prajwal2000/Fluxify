import { eq } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../db";
import { customBlocksListEntity } from "../../../../db/schema";

export async function getCustomBlockById(id: string, tx?: DbTransactionType) {
  const block = await (tx ?? db)
    .select({
      projectId: customBlocksListEntity.projectId,
    })
    .from(customBlocksListEntity)
    .where(eq(customBlocksListEntity.id, id))
    .limit(1);
  return block.length > 0 ? block[0] : null;
}
