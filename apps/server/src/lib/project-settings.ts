import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { projectSettingsEntity } from "../db/schema";
import type { ProjectSettingsKeyType } from "../api/v1/projects/settings/keys/keySchemaMap";

export async function getProjectSetting(
	projectId: string,
	keyName: ProjectSettingsKeyType,
): Promise<string> {
	const result = await db
		.select({ value: projectSettingsEntity.value })
		.from(projectSettingsEntity)
		.where(
			and(
				eq(projectSettingsEntity.projectId, projectId),
				eq(projectSettingsEntity.key, keyName),
			),
		)
		.limit(1);

	return result.length > 0 ? result[0].value : "";
}

export async function setProjectSetting(
	projectId: string,
	keyName: ProjectSettingsKeyType,
	value: string,
): Promise<void> {
	const existing = await db
		.select({ id: projectSettingsEntity.id })
		.from(projectSettingsEntity)
		.where(
			and(
				eq(projectSettingsEntity.projectId, projectId),
				eq(projectSettingsEntity.key, keyName),
			),
		)
		.limit(1);

	if (existing.length > 0) {
		await db
			.update(projectSettingsEntity)
			.set({ value })
			.where(eq(projectSettingsEntity.id, existing[0].id));
	} else {
		await db.insert(projectSettingsEntity).values({
			projectId,
			key: keyName,
			value,
		});
	}
}
