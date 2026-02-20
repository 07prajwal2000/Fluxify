import { db, DbTransactionType } from "../../../../db";
import { testSuitesEntity } from "../../../../db/schema";
import { eq, asc } from "drizzle-orm";

export async function getAllTestSuites(
  routeId: string,
  tx?: DbTransactionType,
) {
  return await (tx ?? db)
    .select()
    .from(testSuitesEntity)
    .where(eq(testSuitesEntity.routeId, routeId))
    .orderBy(asc(testSuitesEntity.createdAt));
}
