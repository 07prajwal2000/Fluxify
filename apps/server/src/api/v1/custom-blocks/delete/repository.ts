import { eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import {
	customBlocksListEntity,
	middlewareBlocksEntity,
	middlewaresEntity,
} from "../../../../db/schema";

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

/** names of the middlewares whose chain includes the block (#534) */
export async function middlewaresUsing(blockId: string, tx?: DbTransactionType) {
	const rows = await (tx ?? db)
		.select({ name: middlewaresEntity.name })
		.from(middlewareBlocksEntity)
		.innerJoin(middlewaresEntity, eq(middlewaresEntity.id, middlewareBlocksEntity.middlewareId))
		.where(eq(middlewareBlocksEntity.customBlockId, blockId));
	return rows.map((r) => `middleware "${r.name}"`);
}
