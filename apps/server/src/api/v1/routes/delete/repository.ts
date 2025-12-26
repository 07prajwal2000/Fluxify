import { eq } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../db";
import { routesEntity } from "../../../../db/schema";

export async function deleteRoute(id: string, tx?: DbTransactionType) {
  await (tx ?? db).delete(routesEntity).where(eq(routesEntity.id, id));
}

export async function findRouteById(id: string, tx?: DbTransactionType) {
  const routes = await (tx ?? db)
    .select({ id: routesEntity.id, projectId: routesEntity.projectId })
    .from(routesEntity)
    .where(eq(routesEntity.id, id));

  return routes.length > 0 ? routes[0] : null;
}
