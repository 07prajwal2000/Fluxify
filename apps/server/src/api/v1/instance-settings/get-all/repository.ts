import { db } from "../../../../db";
import { instanceSettingsEntity } from "../../../../db/schema";

export async function getAllInstanceSettings() {
	return await db.select().from(instanceSettingsEntity);
}
