import {
  customBlocksListEntity,
  blocksEntity,
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
  
  await (tx ?? db)?.insert(blocksEntity).values([
    {
      id: id1,
      customBlockId,
      type: BlockTypes.entrypoint,
      position: { x: 0, y: 0 },
      data: {},
    },
    {
      id: id3,
      customBlockId,
      type: BlockTypes.errorHandler,
      // a block is ~168px wide; anything less than that sits on top of the
      // entrypoint on the current node design
      position: { x: -240, y: 0 },
      data: {
        next: "",
        retryAfterFail: false,
        retryCount: 0,
      },
    },
  ]);
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
