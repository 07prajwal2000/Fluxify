import { eq, type InferInsertModel } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { testSuitesEntity } from "../../../../db/schema";

export async function updateTestSuite(
	id: string,
	updateData: Partial<InferInsertModel<typeof testSuitesEntity>>,
	tx?: DbTransactionType,
) {
	const [result] = await (tx ?? db)
		.update(testSuitesEntity)
		.set(updateData)
		.where(eq(testSuitesEntity.id, id))
		.returning();
	return result;
}
