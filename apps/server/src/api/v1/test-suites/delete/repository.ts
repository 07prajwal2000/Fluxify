import { db, DbTransactionType } from "../../../../db";
import { testSuitesEntity } from "../../../../db/schema";
import { eq } from "drizzle-orm";

export async function deleteTestSuite(id: string, tx?: DbTransactionType) {
  await (tx ?? db).delete(testSuitesEntity).where(eq(testSuitesEntity.id, id));
}
