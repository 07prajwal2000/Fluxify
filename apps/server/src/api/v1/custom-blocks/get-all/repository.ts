import { db } from "../../../../db";
import { customBlocksListEntity } from "../../../../db/schema";
import { eq } from "drizzle-orm";

export async function getCustomBlocks(projectId: string) {
  return await db
    .select({
      id: customBlocksListEntity.id,
      label: customBlocksListEntity.label,
      name: customBlocksListEntity.name,
      icon: customBlocksListEntity.icon,
      iconUrl: customBlocksListEntity.iconUrl,
      inputParams: customBlocksListEntity.inputParams,
      description: customBlocksListEntity.description,
      sourceType: customBlocksListEntity.sourceType,
      source: customBlocksListEntity.source,
    })
    .from(customBlocksListEntity)
    .where(eq(customBlocksListEntity.projectId, projectId));
}
