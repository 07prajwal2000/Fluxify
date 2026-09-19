import type { InferInsertModel } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { testSuitesEntity } from "../../../../db/schema";

export async function createTestSuite(
	data: InferInsertModel<typeof testSuitesEntity>,
	tx?: DbTransactionType,
) {
	const [result] = await (tx ?? db).insert(testSuitesEntity).values(data).returning();
	return result;
}
