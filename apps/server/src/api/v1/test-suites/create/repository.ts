import { db, DbTransactionType } from "../../../../db";
import { testSuitesEntity } from "../../../../db/schema";
import { InferInsertModel } from "drizzle-orm";

export async function createTestSuite(
  data: InferInsertModel<typeof testSuitesEntity>,
  tx?: DbTransactionType,
) {
  const [result] = await (tx ?? db)
    .insert(testSuitesEntity)
    .values(data)
    .returning();
  return result;
}
