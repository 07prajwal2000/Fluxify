import { db, DbTransactionType } from "../../../../db";
import { testSuitesEntity, routesEntity } from "../../../../db/schema";
import { eq, asc } from "drizzle-orm";

export async function getRouteAndAllTestSuites(
  routeId: string,
  tx?: DbTransactionType,
) {
  const suites = await (tx ?? db)
    .select()
    .from(testSuitesEntity)
    .where(eq(testSuitesEntity.routeId, routeId))
    .orderBy(asc(testSuitesEntity.createdAt));

  const route = await (tx ?? db)
    .select()
    .from(routesEntity)
    .where(eq(routesEntity.id, routeId))
    .then((res) => res[0]);

  return { suites, route };
}
