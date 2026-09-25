import { eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import { testSuiteBlockHooksEntity, testSuitesEntity } from "../../../../db/schema";

export async function getTestSuiteById(id: string, tx?: DbTransactionType) {
	const [suite] = await (tx ?? db)
		.select()
		.from(testSuitesEntity)
		.where(eq(testSuitesEntity.id, id));
	return suite;
}

export async function getTestSuiteHooks(suiteId: string) {
	return db
		.select({
			blockId: testSuiteBlockHooksEntity.blockId,
			onBefore: testSuiteBlockHooksEntity.onBefore,
			onAfter: testSuiteBlockHooksEntity.onAfter,
		})
		.from(testSuiteBlockHooksEntity)
		.where(eq(testSuiteBlockHooksEntity.suiteId, suiteId));
}
