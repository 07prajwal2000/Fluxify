import { and, count, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../../../../db";
import { canvasVersionsEntity, traceRunsEntity } from "../../../../db/schema";
import { type SuiteTarget, targetColumn } from "../../../../modules/testRunner/target";
import type { requestQuerySchema } from "./dto";

/** whose runs: a route or workflow, or a sandbox (#735), which only its owner's endpoints read */
export type RunTarget = SuiteTarget | { type: "sandbox"; id: string };

export const runTargetColumn = (target: RunTarget) =>
	target.type === "sandbox"
		? traceRunsEntity.sandboxId
		: targetColumn(traceRunsEntity, target.type);

/**
 * Recorded runs for one route or workflow, newest first. Headers only — the
 * portal polls this, so it never touches spans and rides the
 * `(project, target, started_at desc)` index.
 */
export async function getRecordedRuns(
	projectId: string,
	target: RunTarget,
	{
		outcome,
		from,
		to,
		source,
		testRunId,
		env,
		versionId,
		search,
	}: Pick<
		z.infer<typeof requestQuerySchema>,
		"outcome" | "from" | "to" | "source" | "testRunId" | "env" | "versionId" | "search"
	>,
	skip: number,
	take: number,
) {
	const where = and(
		eq(traceRunsEntity.projectId, projectId),
		eq(runTargetColumn(target), target.id),
		outcome ? eq(traceRunsEntity.outcome, outcome) : undefined,
		env ? eq(traceRunsEntity.env, env) : undefined,
		versionId ? eq(traceRunsEntity.versionId, versionId) : undefined,
		from ? gte(traceRunsEntity.startedAt, from) : undefined,
		to ? lt(traceRunsEntity.startedAt, to) : undefined,
		testRunsFilter(source, testRunId),
		searchFilter(search),
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
			env: traceRunsEntity.env,
			versionId: traceRunsEntity.versionId,
			versionNumber: canvasVersionsEntity.versionNumber,
			metadata: traceRunsEntity.metadata,
		})
		.from(traceRunsEntity)
		.leftJoin(canvasVersionsEntity, eq(canvasVersionsEntity.id, traceRunsEntity.versionId))
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

/** free-text search over the few text-like fields a run header has */
function searchFilter(search?: string) {
	if (!search) return undefined;
	const pattern = `%${search}%`;
	const metadata = traceRunsEntity.metadata;
	return or(
		ilike(sql`${traceRunsEntity.statusCode}::text`, pattern),
		ilike(sql`${traceRunsEntity.id}::text`, pattern),
		ilike(sql`${metadata}->>'label'`, pattern),
		ilike(sql`${metadata}->>'suiteName'`, pattern),
		ilike(sql`${metadata}->>'caseName'`, pattern),
	);
}

/** test traces (#627) are listed with normal runs unless a filter narrows it */
function testRunsFilter(source?: "test" | "live", testRunId?: string) {
	const metadata = traceRunsEntity.metadata;
	if (testRunId) return sql`${metadata}->>'testRunId' = ${testRunId}`;
	if (source === "test") return sql`${metadata}->>'source' = 'test'`;
	if (source === "live") return sql`(${metadata}->>'source') is distinct from 'test'`;
	return undefined;
}
