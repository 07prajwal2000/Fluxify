import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { instanceSettingsEntity } from "../../../../db/schema";
import { generateID } from "@fluxify/lib";

export async function getInstanceSettingByKey(key: string) {
	const rows = await db
		.select()
		.from(instanceSettingsEntity)
		.where(eq(instanceSettingsEntity.key, key));
	return rows[0] ?? null;
}

export async function upsertInstanceSetting(data: {
	key: string;
	category: string;
	value: Record<string, unknown>;
	isPublic?: boolean;
}) {
	const now = new Date();
	const existing = await getInstanceSettingByKey(data.key);
	const isPublic = data.isPublic ?? existing?.isPublic ?? false;

	const [updated] = await db
		.insert(instanceSettingsEntity)
		.values({
			id: generateID(),
			key: data.key,
			category: data.category as any,
			value: data.value,
			isPublic,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: instanceSettingsEntity.key,
			set: {
				value: data.value,
				category: data.category as any,
				isPublic,
				updatedAt: now,
			},
		})
		.returning();

	return updated;
}
