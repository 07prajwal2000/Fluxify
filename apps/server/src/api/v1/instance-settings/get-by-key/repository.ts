import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { instanceSettingsEntity } from "../../../../db/schema";

export async function getInstanceSettingByKey(key: string) {
	const rows = await db
		.select()
		.from(instanceSettingsEntity)
		.where(eq(instanceSettingsEntity.key, key));
	return rows[0] ?? null;
}
