import { createInsertSchema } from "drizzle-zod";
import { db, DbTransactionType } from "../../../../db";
import { blocksEntity, edgesEntity, routesEntity } from "../../../../db/schema";
import z from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";

const insertBlocksSchema = createInsertSchema(blocksEntity);
const insertEntitySchema = createInsertSchema(edgesEntity);

export async function upsertBlocks(
  blocks: z.infer<typeof insertBlocksSchema>[],
  tx?: DbTransactionType
) {
  await (tx ?? db)
    .insert(blocksEntity)
    .values(blocks)
    .onConflictDoUpdate({
      target: blocksEntity.id,
      set: {
        type: sql`excluded.type`,
        position: sql`excluded.position`,
        data: sql`excluded.data`,
        updatedAt: sql`excluded.updated_at`,
        routeId: sql`excluded.route_id`,
      },
    });
}

export async function deleteBlocks(blockIds: string[], tx?: DbTransactionType) {
  await (tx ?? db)
    .delete(blocksEntity)
    .where(inArray(blocksEntity.id, blockIds));
}

export async function insertEdges(
  edges: z.infer<typeof insertEntitySchema>[],
  tx?: DbTransactionType
) {
  await (tx ?? db).insert(edgesEntity).values(edges);
}

export async function deleteEdges(edgeIds: string[], tx?: DbTransactionType) {
  await (tx ?? db).delete(edgesEntity).where(inArray(edgesEntity.id, edgeIds));
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
