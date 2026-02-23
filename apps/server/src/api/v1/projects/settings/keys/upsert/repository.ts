import { and, eq } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../../../db/index";
import {
  projectSettingsEntity,
  projectsEntity,
} from "../../../../../../db/schema";

export async function upsertProjectSettingKey(
  projectId: string,
  key: string,
  value: string,
  tx?: DbTransactionType,
) {
  const dbOrTx = tx || db;
  const existing = await dbOrTx
    .select({ id: projectSettingsEntity.id })
    .from(projectSettingsEntity)
    .where(
      and(
        eq(projectSettingsEntity.projectId, projectId),
        eq(projectSettingsEntity.key, key),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return dbOrTx
      .update(projectSettingsEntity)
      .set({ value })
      .where(eq(projectSettingsEntity.id, existing[0].id));
  } else {
    return dbOrTx.insert(projectSettingsEntity).values({
      projectId,
      key,
      value,
    });
  }
}

export async function checkProjectExists(
  projectId: string,
  tx?: DbTransactionType,
) {
  const dbOrTx = tx || db;
  const project = await dbOrTx
    .select({ id: projectsEntity.id })
    .from(projectsEntity)
    .where(eq(projectsEntity.id, projectId))
    .limit(1);
  return project.length > 0;
}
