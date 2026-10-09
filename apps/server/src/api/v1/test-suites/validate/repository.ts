import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../../../../db";
import { testSuiteRunsEntity } from "../../../../db/schema";
import { sampleOfRun } from "../../../../modules/testRunner/validateSuite";

/** the newest run of the suite that got an answer back */
export async function lastRunSample(suiteId: string) {
	const runs = await db
		.select({ result: testSuiteRunsEntity.result })
		.from(testSuiteRunsEntity)
		.where(and(eq(testSuiteRunsEntity.testSuiteId, suiteId), isNotNull(testSuiteRunsEntity.result)))
		.orderBy(desc(testSuiteRunsEntity.createdAt))
		.limit(10);
	for (const { result } of runs) {
		const sample = result && sampleOfRun(result);
		if (sample) return sample;
	}
	return undefined;
}
