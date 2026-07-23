import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { instanceSettingsEntity } from "../../../../db/schema";

export async function getInstanceSettingsByCategory(category: string) {
	return await db
		.select()
		.from(instanceSettingsEntity)
		.where(eq(instanceSettingsEntity.category, category as any));
}
