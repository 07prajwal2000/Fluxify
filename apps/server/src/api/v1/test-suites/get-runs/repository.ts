import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { testRunsEntity, testSuiteRunsEntity } from "../../../../db/schema";
import { type SuiteTarget, targetColumn } from "../../../../modules/testRunner/target";

/**
 * Runs for one route or workflow, newest first.
 *
 * Scoped by project AND target, so a target id from another project simply
 * returns nothing — no ownership join, no extra read.
 */
export async function getTestRuns(
	projectId: string,
	target: SuiteTarget,
	skip: number,
	take: number,
	suiteId?: string,
) {
	const where = and(
		eq(testRunsEntity.projectId, projectId),
		eq(targetColumn(testRunsEntity, target.type), target.id),
		suiteId
			? inArray(
					testRunsEntity.id,
					db
						.select({ id: testSuiteRunsEntity.testRunId })
						.from(testSuiteRunsEntity)
						.where(eq(testSuiteRunsEntity.testSuiteId, suiteId)),
				)
			: undefined,
	);

	const result = await db
		.select({
			id: testRunsEntity.id,
			status: testRunsEntity.status,
			totalSuites: testRunsEntity.totalSuites,
			env: testRunsEntity.env,
			deploymentId: testRunsEntity.deploymentId,
			skippedCount: sql<number>`coalesce((${testRunsEntity.result}->>'skipped')::int, 0)`,
			passedCount: testRunsEntity.passedCount,
			failedCount: testRunsEntity.failedCount,
			durationMs: testRunsEntity.durationMs,
			startedAt: testRunsEntity.startedAt,
			finishedAt: testRunsEntity.finishedAt,
			createdAt: testRunsEntity.createdAt,
		})
		.from(testRunsEntity)
		.where(where)
		.orderBy(desc(testRunsEntity.createdAt))
		.offset(skip)
		.limit(take);

	const [total] = await db
		.select({ count: count(testRunsEntity.id) })
		.from(testRunsEntity)
		.where(where);

	return { result, totalCount: total?.count ?? 0 };
}
