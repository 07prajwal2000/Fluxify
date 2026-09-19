import { eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { customBlocksListEntity } from "../../../../db/schema";

export async function getCustomBlockById(id: string, tx?: DbTransactionType) {
	const block = await (tx ?? db)
		.select({
			id: customBlocksListEntity.id,
			projectId: customBlocksListEntity.projectId,
			sourceType: customBlocksListEntity.sourceType,
		})
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.id, id))
		.limit(1);
	return block[0];
}

export async function deleteCustomBlock(id: string, tx?: DbTransactionType) {
	await (tx ?? db).delete(customBlocksListEntity).where(eq(customBlocksListEntity.id, id));
}
