import { asc, eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { testSuitesEntity } from "../../../../db/schema";
import { type SuiteTarget, targetColumn } from "../../../../modules/testRunner/target";

export async function getAllTestSuites(target: SuiteTarget, tx?: DbTransactionType) {
	return await (tx ?? db)
		.select()
		.from(testSuitesEntity)
		.where(eq(targetColumn(testSuitesEntity, target.type), target.id))
		.orderBy(asc(testSuitesEntity.createdAt));
}
