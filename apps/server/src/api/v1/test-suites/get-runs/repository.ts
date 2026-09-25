import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { testRunsEntity } from "../../../../db/schema";
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
) {
	const where = and(
		eq(testRunsEntity.projectId, projectId),
		eq(targetColumn(testRunsEntity, target.type), target.id),
	);

	const result = await db
		.select({
			id: testRunsEntity.id,
			status: testRunsEntity.status,
			totalSuites: testRunsEntity.totalSuites,
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
