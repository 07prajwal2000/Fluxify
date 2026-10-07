import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { testRunsEntity, testSuiteRunsEntity, traceRunsEntity } from "../../../../db/schema";
import { RECORDING_MAX_AGE_DAYS } from "../../../../lib/env";
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

	const traces = await getCaseTraces(projectId, runId);
	const ageMs = Date.now() - run.createdAt.getTime();
	return {
		...run,
		// past the max age its traces are gone, so "View trace" says so (#627)
		traceExpired: ageMs > RECORDING_MAX_AGE_DAYS * 24 * 60 * 60_000,
		suiteRuns: suiteRuns.map((suiteRun) => ({
			...suiteRun,
			traces: traces
				.filter((t) => t.suiteId === suiteRun.testSuiteId)
				.map(({ suiteId, ...t }) => t),
		})),
	};
}

/**
 * Each case's trace (#627), found by the test run id its metadata carries — the
 * partial `idx_trace_runs_test_run_id` index. Async runs a case forked are left
 * out: they hang off the case's own trace.
 */
async function getCaseTraces(projectId: string, testRunId: string) {
	const metadata = traceRunsEntity.metadata;
	return db
		.select({
			traceRunId: traceRunsEntity.id,
			suiteId: sql<string>`${metadata}->>'suiteId'`,
			caseIndex: sql<number>`(${metadata}->>'caseIndex')::int`,
		})
		.from(traceRunsEntity)
		.where(
			and(
				eq(traceRunsEntity.projectId, projectId),
				sql`${metadata}->>'testRunId' = ${testRunId}`,
				isNull(traceRunsEntity.parentRunId),
			),
		);
}
