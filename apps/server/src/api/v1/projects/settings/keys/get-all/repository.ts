import { eq } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../../../db/index";
import {
  projectSettingsEntity,
  projectsEntity,
} from "../../../../../../db/schema";

export async function getProjectSettingsKeys(
  projectId: string,
  tx?: DbTransactionType,
) {
  const dbOrTx = tx || db;
  return dbOrTx
    .select({
      key: projectSettingsEntity.key,
      value: projectSettingsEntity.value,
    })
    .from(projectSettingsEntity)
    .where(eq(projectSettingsEntity.projectId, projectId));
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
