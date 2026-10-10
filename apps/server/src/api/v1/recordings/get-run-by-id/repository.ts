import { and, asc, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { traceRunsEntity, traceSpansEntity } from "../../../../db/schema";
import { type RunTarget, runTargetColumn } from "../get-runs/repository";

/**
 * One recorded run, every span it holds and the async runs it forked.
 *
 * The run lookup carries the project and target from the path, so a run id from
 * another project or target reads as one that does not exist.
 */
export async function getRecordedRunById(projectId: string, target: RunTarget, runId: string) {
	const [run] = await db
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
			parentSeq: traceRunsEntity.parentSeq,
			routeVersion: traceRunsEntity.routeVersion,
			workflowVersion: traceRunsEntity.workflowVersion,
			metadata: traceRunsEntity.metadata,
		})
		.from(traceRunsEntity)
		.where(
			and(
				eq(traceRunsEntity.id, runId),
				eq(traceRunsEntity.projectId, projectId),
				eq(runTargetColumn(target), target.id),
			),
		);
	if (!run) return null;

	const spans = await db
		.select({
			seq: traceSpansEntity.seq,
			parentSeq: traceSpansEntity.parentSeq,
			blockId: traceSpansEntity.blockId,
			blockType: traceSpansEntity.blockType,
			blockName: traceSpansEntity.blockName,
			customBlockId: traceSpansEntity.customBlockId,
			middleware: traceSpansEntity.middleware,
			startedAt: traceSpansEntity.startedAt,
			endedAt: traceSpansEntity.endedAt,
			outcome: traceSpansEntity.outcome,
			branch: traceSpansEntity.branch,
			error: traceSpansEntity.error,
			input: traceSpansEntity.input,
			output: traceSpansEntity.output,
			truncated: traceSpansEntity.truncated,
			metadata: traceSpansEntity.metadata,
		})
		.from(traceSpansEntity)
		.where(eq(traceSpansEntity.runId, runId))
		.orderBy(asc(traceSpansEntity.seq));

	const childRuns = await db
		.select({ id: traceRunsEntity.id, parentSeq: traceRunsEntity.parentSeq })
		.from(traceRunsEntity)
		.where(and(eq(traceRunsEntity.parentRunId, runId), eq(traceRunsEntity.projectId, projectId)))
		.orderBy(asc(traceRunsEntity.startedAt));

	return { ...run, spans, childRuns };
}
