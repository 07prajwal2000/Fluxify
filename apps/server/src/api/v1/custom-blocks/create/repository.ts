import {
  customBlocksListEntity,
  customBlockGraphsEntity,
  projectsEntity,
} from "../../../../db/schema";
import { db, DbTransactionType } from "../../../../db";
import { eq, and } from "drizzle-orm";
import { generateID } from "@fluxify/lib";
import { BlockTypes } from "@fluxify/blocks";

export async function createCustomBlock(
  data: typeof customBlocksListEntity.$inferInsert,
  tx?: DbTransactionType
) {
  const newBlock = await (tx ?? db)
    .insert(customBlocksListEntity)
    .values(data)
    .returning();
  return newBlock[0].id;
}

export async function createDependencies(
  customBlockId: string,
  tx?: DbTransactionType
) {
  const id1 = generateID();
  const id3 = generateID();
  
  await (tx ?? db)?.insert(customBlockGraphsEntity).values({
    id: id1,
    customBlockId,
    type: BlockTypes.entrypoint,
    data: {
      position: { x: 0, y: 0 }
    },
  });
  
  await (tx ?? db)?.insert(customBlockGraphsEntity).values({
    id: id3,
    customBlockId,
    type: BlockTypes.errorHandler,
    data: {
      position: { x: 25, y: 0 },
      next: "",
      retryAfterFail: false,
      retryCount: 0,
    },
  });
}

export async function checkCustomBlockExist(
  projectId: string,
  name: string,
  tx?: DbTransactionType
) {
  const exist = await (tx ?? db)
    .select({ id: customBlocksListEntity.id })
    .from(customBlocksListEntity)
    .where(
      and(
        eq(customBlocksListEntity.projectId, projectId),
        eq(customBlocksListEntity.name, name)
      )
    )
    .limit(1);
  return exist.length > 0;
}

export async function checkProjectExist(id: string, tx?: DbTransactionType) {
  const project = await (tx ?? db)
    .select({ id: projectsEntity.id })
    .from(projectsEntity)
    .where(eq(projectsEntity.id, id))
    .limit(1);
  return project.length > 0;
}
