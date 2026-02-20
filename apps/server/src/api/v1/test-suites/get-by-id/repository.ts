import { db, DbTransactionType } from "../../../../db";
import { testSuitesEntity } from "../../../../db/schema";
import { eq } from "drizzle-orm";

export async function getTestSuiteById(id: string, tx?: DbTransactionType) {
  const [suite] = await (tx ?? db)
    .select()
    .from(testSuitesEntity)
    .where(eq(testSuitesEntity.id, id));
  return suite;
}
