import { and, eq } from "drizzle-orm";
import { db, DbTransactionType } from "../../../../../../db/index";
import {
  integrationsEntity,
  projectSettingsEntity,
  projectsEntity,
} from "../../../../../../db/schema";

/** Picking an AI integration as the project's agent connection IS the opt-in, so
 *  flip `config.useForHarness` on it.
 *
 *  Read-modify-write in JS rather than a `jsonb ||` merge, so rows written by the
 *  old double-encoding path (jsonb holding a JSON *string* — see `db/jsonbColumn.ts`)
 *  are healed on write instead of being merged into an array. */
export async function markIntegrationForHarness(
  projectId: string,
  integrationId: string,
  tx?: DbTransactionType,
) {
  const dbOrTx = tx ?? db;
  const where = and(
    eq(integrationsEntity.id, integrationId),
    eq(integrationsEntity.projectId, projectId),
  );

  const existing = await dbOrTx
    .select({ config: integrationsEntity.config })
    .from(integrationsEntity)
    .where(where)
    .limit(1);
  if (existing.length === 0) return;

  const config = (existing[0].config ?? {}) as Record<string, unknown>;
  if (config.useForHarness === true) return;

  return dbOrTx
    .update(integrationsEntity)
    .set({ config: { ...config, useForHarness: true } })
    .where(where);
}

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
