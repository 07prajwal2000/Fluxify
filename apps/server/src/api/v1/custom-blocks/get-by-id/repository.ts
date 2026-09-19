import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { customBlocksListEntity } from "../../../../db/schema";

export async function getCustomBlockById(id: string) {
	const block = await db
		.select()
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.id, id))
		.limit(1);
	return block[0];
}
