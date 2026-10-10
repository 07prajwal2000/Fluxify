import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { traceRunsEntity } from "../../../../db/schema";
import { type SuiteTarget, targetColumn } from "../../../../modules/testRunner/target";

/**
 * Deletes one recorded run, or every run of a route or workflow when `runId` is
 * left out. Scoped by project AND target, so ids from elsewhere delete nothing.
 * Spans and the run's `runtime` system logs cascade with it — see the foreign
 * keys in `db/schema.ts`.
 */
export async function deleteRecordedRuns(projectId: string, target: SuiteTarget, runId?: string) {
	const deleted = await db
		.delete(traceRunsEntity)
		.where(
			and(
				eq(traceRunsEntity.projectId, projectId),
				eq(targetColumn(traceRunsEntity, target.type), target.id),
				runId ? eq(traceRunsEntity.id, runId) : undefined,
			),
		)
		.returning({ id: traceRunsEntity.id });

	return deleted.length;
}
