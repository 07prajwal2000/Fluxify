import { createInsertSchema } from "drizzle-zod";
import { db, DbTransactionType } from "../../../../db";
import { blocksEntity, edgesEntity, routesEntity } from "../../../../db/schema";
import z from "zod";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { BlockTypes } from "@fluxify/blocks";

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

export async function getBlocksCountByType(routeId: string, blocks: BlockTypes[], tx?: DbTransactionType) {
  const duplicateBlocks = await (tx ?? db)
    .select({  count: count(blocksEntity.id), type: blocksEntity.type })
    .from(blocksEntity)
    .where(and(eq(blocksEntity.routeId, routeId), inArray(blocksEntity.type, blocks)))
    .groupBy(blocksEntity.type);

  return duplicateBlocks;
}

export async function deleteBlocks(blockIds: string[], tx?: DbTransactionType) {
  await (tx ?? db)
    .delete(blocksEntity)
    .where(
      and(
        inArray(blocksEntity.id, blockIds),
        ne(blocksEntity.type, BlockTypes.entrypoint),
        ne(blocksEntity.type, BlockTypes.errorHandler)
      )
    );
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
