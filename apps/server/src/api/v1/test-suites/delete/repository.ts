import { eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { testSuitesEntity } from "../../../../db/schema";

export async function deleteTestSuite(id: string, tx?: DbTransactionType) {
	await (tx ?? db).delete(testSuitesEntity).where(eq(testSuitesEntity.id, id));
}
