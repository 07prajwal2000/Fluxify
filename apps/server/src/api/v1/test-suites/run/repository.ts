import { db, DbTransactionType } from "../../../../db";
import { testSuitesEntity, routesEntity } from "../../../../db/schema";
import { eq } from "drizzle-orm";

export async function getTestSuiteWithRoute(
  suiteId: string,
  tx?: DbTransactionType,
) {
  const suite = await (tx ?? db)
    .select()
    .from(testSuitesEntity)
    .where(eq(testSuitesEntity.id, suiteId))
    .then((res) => res[0]);

  if (!suite) return { suite: null, route: null };

  const route = await (tx ?? db)
    .select()
    .from(routesEntity)
    .where(eq(routesEntity.id, suite.routeId as string))
    .then((res) => res[0]);

  return { suite, route };
}
