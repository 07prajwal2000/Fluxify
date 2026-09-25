import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { testRunsEntity, testSuiteRunsEntity } from "../../../../db/schema";
import { type SuiteTarget, targetColumn } from "../../../../modules/testRunner/target";

/**
 * One run plus every suite it covers.
 *
 * The parent lookup carries the project and target from the path, so a run id
 * belonging to another project is indistinguishable from one that does not
 * exist — which is the answer we want to give anyway.
 */
export async function getTestRunById(projectId: string, target: SuiteTarget, runId: string) {
	const [run] = await db
		.select()
		.from(testRunsEntity)
		.where(
			and(
				eq(testRunsEntity.id, runId),
				eq(testRunsEntity.projectId, projectId),
				eq(targetColumn(testRunsEntity, target.type), target.id),
			),
		);
	if (!run) return null;

	const suiteRuns = await db
		.select({
			id: testSuiteRunsEntity.id,
			testSuiteId: testSuiteRunsEntity.testSuiteId,
			status: testSuiteRunsEntity.status,
			result: testSuiteRunsEntity.result,
			durationMs: testSuiteRunsEntity.durationMs,
			startedAt: testSuiteRunsEntity.startedAt,
			finishedAt: testSuiteRunsEntity.finishedAt,
		})
		.from(testSuiteRunsEntity)
		.where(eq(testSuiteRunsEntity.testRunId, runId));

	return { ...run, suiteRuns };
}
