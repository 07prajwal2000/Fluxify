import { db, DbTransactionType } from "../../../../db";
import { testSuitesEntity } from "../../../../db/schema";
import { eq, InferInsertModel } from "drizzle-orm";

export async function updateTestSuite(
  id: string,
  updateData: Partial<InferInsertModel<typeof testSuitesEntity>>,
  tx?: DbTransactionType,
) {
  const [result] = await (tx ?? db)
    .update(testSuitesEntity)
    .set(updateData)
    .where(eq(testSuitesEntity.id, id))
    .returning();
  return result;
}
