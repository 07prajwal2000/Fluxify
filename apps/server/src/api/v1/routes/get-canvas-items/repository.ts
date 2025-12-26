import { and, eq, inArray } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../db";
import { blocksEntity, edgesEntity, routesEntity } from "../../../../db/schema";

// repository code goes here
export async function getBlocks(routeId: string, tx?: DbTransactionType) {
  const blocks = await (tx ?? db)
    .select({
      id: blocksEntity.id,
      type: blocksEntity.type,
      data: blocksEntity.data,
      position: blocksEntity.position,
    })
    .from(blocksEntity)
    .where(eq(blocksEntity.routeId, routeId));
  return blocks;
}

export async function getEdges(routeId: string, tx?: DbTransactionType) {
  const edges = await (tx ?? db)
    .select({
      id: edgesEntity.id,
      from: edgesEntity.from,
      to: edgesEntity.to,
      fromHandle: edgesEntity.fromHandle,
      toHandle: edgesEntity.toHandle,
    })
    .from(edgesEntity)
    .where(eq(edgesEntity.routeId, routeId));
  return edges;
}

export async function routeExist(
  routeId: string,
  projectIds: string[] = [],
  tx?: DbTransactionType
) {
  const isSystemAdmin = projectIds.some((id) => id === "*");
  const route = await (tx ?? db)
    .select({
      id: routesEntity.id,
    })
    .from(routesEntity)
    .where(
      and(
        eq(routesEntity.id, routeId),
        isSystemAdmin ? undefined : inArray(routesEntity.projectId, projectIds)
      )
    )
    .limit(1);
  return route.length > 0;
}
