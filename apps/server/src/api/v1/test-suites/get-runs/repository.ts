import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { testRunsEntity } from "../../../../db/schema";

/**
 * Runs for one route, newest first.
 *
 * Scoped by project AND route, so a route id from another project simply
 * returns nothing — no ownership join, no extra read.
 */
export async function getTestRuns(
	projectId: string,
	routeId: string,
	skip: number,
	take: number,
) {
	const where = and(
		eq(testRunsEntity.projectId, projectId),
		eq(testRunsEntity.routeId, routeId),
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
