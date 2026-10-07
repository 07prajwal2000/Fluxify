import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../../../../db";
import { traceRunsEntity } from "../../../../db/schema";
import { type SuiteTarget, targetColumn } from "../../../../modules/testRunner/target";
import type { requestQuerySchema } from "./dto";

/**
 * Recorded runs for one route or workflow, newest first. Headers only — the
 * portal polls this, so it never touches spans and rides the
 * `(project, target, started_at desc)` index.
 */
export async function getRecordedRuns(
	projectId: string,
	target: SuiteTarget,
	{
		outcome,
		from,
		to,
		source,
		testRunId,
	}: Pick<z.infer<typeof requestQuerySchema>, "outcome" | "from" | "to" | "source" | "testRunId">,
	skip: number,
	take: number,
) {
	const where = and(
		eq(traceRunsEntity.projectId, projectId),
		eq(targetColumn(traceRunsEntity, target.type), target.id),
		outcome ? eq(traceRunsEntity.outcome, outcome) : undefined,
		from ? gte(traceRunsEntity.startedAt, from) : undefined,
		to ? lt(traceRunsEntity.startedAt, to) : undefined,
		testRunsFilter(source, testRunId),
	);

	const result = await db
		.select({
			id: traceRunsEntity.id,
			outcome: traceRunsEntity.outcome,
			statusCode: traceRunsEntity.statusCode,
			startedAt: traceRunsEntity.startedAt,
			endedAt: traceRunsEntity.endedAt,
			spanCount: traceRunsEntity.spanCount,
			truncated: traceRunsEntity.truncated,
			droppedSpans: traceRunsEntity.droppedSpans,
			parentRunId: traceRunsEntity.parentRunId,
			metadata: traceRunsEntity.metadata,
		})
		.from(traceRunsEntity)
		.where(where)
		.orderBy(desc(traceRunsEntity.startedAt), desc(traceRunsEntity.id))
		.offset(skip)
		.limit(take);

	const [total] = await db
		.select({ count: count(traceRunsEntity.id) })
		.from(traceRunsEntity)
		.where(where);

	return { result, totalCount: total?.count ?? 0 };
}

/** test traces (#627) are listed with normal runs unless a filter narrows it */
function testRunsFilter(source?: "test" | "live", testRunId?: string) {
	const metadata = traceRunsEntity.metadata;
	if (testRunId) return sql`${metadata}->>'testRunId' = ${testRunId}`;
	if (source === "test") return sql`${metadata}->>'source' = 'test'`;
	if (source === "live") return sql`(${metadata}->>'source') is distinct from 'test'`;
	return undefined;
}
