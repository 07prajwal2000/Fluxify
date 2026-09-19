import { eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { testSuitesEntity } from "../../../../db/schema";

export async function getTestSuiteById(id: string, tx?: DbTransactionType) {
	const [suite] = await (tx ?? db)
		.select()
		.from(testSuitesEntity)
		.where(eq(testSuitesEntity.id, id));
	return suite;
}
