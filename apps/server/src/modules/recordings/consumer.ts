import { logger } from "@fluxify/common";
import { consumeQueue, ensureStreamConsumer, type QueueConsumer } from "@fluxify/common/nats";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { and, eq, inArray, lt } from "drizzle-orm";
import z from "zod";
import { db } from "../../db";
import { natsConnection } from "../../db/nats";
import { routesEntity, traceRunsEntity, traceSpansEntity, workflowsEntity } from "../../db/schema";
import { RECORDING_MAX_AGE_DAYS } from "../../lib/env";
import { onSystemTick } from "../schedules/system";
import { MAX_SPANS_PER_RUN } from "../telemetry/routeRecorder";
import { RECORDINGS_CONSUMER, RECORDINGS_STREAM, RECORDINGS_STREAM_SPEC } from "./stream";

/**
 * The recordings consumer (#254). Admin only: it writes Postgres, which no
 * worker may open. Shared durable, so any number of admins split the stream.
 */

const MAX_DELIVER = 5;
/** runs per retention delete; each takes its spans with it, up to 1,000 apiece */
const RETENTION_BATCH = 100;

const outcome = z.enum(["success", "failure"]);
const time = z.number().finite();
const id = z.string().min(1).max(50);

/** a test run's trace (#627); the worker supervisor attaches it, not the test child */
const metadataSchema = z.object({
	source: z.literal("test"),
	label: z.string().max(500),
	testRunId: id,
	suiteId: id,
	suiteName: z.string().max(200),
	caseIndex: z.number().int().nonnegative(),
	caseName: z.string().max(200),
});

/** a test hook's mock on a span (#627) */
const spanMetadataSchema = z.object({
	mocked: z.object({ input: z.literal(true).optional(), output: z.literal(true).optional() }),
});

/** Only what the insert relies on; anything else is stored as it came. */
const runSchema = z
	.object({
		runId: z.uuid(),
		projectId: z.string().min(1).max(50),
		routeId: z.string().min(1).max(50).optional(),
		workflowId: z.string().min(1).max(50).optional(),
		routeVersion: z.string().max(50).optional(),
		workflowVersion: z.string().max(50).optional(),
		startedAtWallMs: time,
		perfOrigin: time,
		endedAt: time,
		outcome,
		statusCode: z.number().int().optional(),
		truncated: z.boolean().optional(),
		droppedSpans: z.number().int().nonnegative().optional(),
		parentRunId: z.uuid().optional(),
		parentSeq: z.number().int().optional(),
		metadata: metadataSchema.optional(),
		spans: z
			.array(
				z.looseObject({
					seq: z.number().int().nonnegative(),
					parentSeq: z.number().int().optional(),
					blockId: z.string(),
					blockType: z.string(),
					blockName: z.string().optional(),
					customBlockId: z.string().max(50).optional(),
					startedAt: time,
					endedAt: time,
					outcome,
					branch: outcome.optional(),
					error: z.string().optional(),
					truncated: z.boolean().optional(),
					metadata: spanMetadataSchema.optional(),
				}),
			)
			.max(MAX_SPANS_PER_RUN),
	})
	.refine((run) => Boolean(run.routeId) !== Boolean(run.workflowId), {
		message: "a run belongs to exactly one route or workflow",
	});

export async function startRecordingConsumer(): Promise<QueueConsumer[]> {
	const nc = natsConnection();
	// not caught: NATS is a hard dependency, and an admin that silently records
	// nothing is worse than one that refuses to boot
	await ensureStreamConsumer(nc, RECORDINGS_STREAM_SPEC, {
		durable: RECORDINGS_CONSUMER,
		ackWaitMs: 30_000,
		maxDeliver: MAX_DELIVER,
	});
	const recordings = await consumeQueue<TraceRunPayload>(
		nc,
		RECORDINGS_STREAM,
		RECORDINGS_CONSUMER,
		async (message) => void (await persistRecording(message.data)),
		{ concurrency: 4, maxAttempts: MAX_DELIVER },
	);
	const retention = await onSystemTick("daily", "recording-retention", async () => {
		await deleteExpiredRecordings();
	});
	logger.info("[recordings] consumer listening", "RECORDINGS");
	return [recordings, retention];
}

/**
 * Writes one run and its spans, or drops it. Throws only on a database error,
 * which the queue retries; everything else is decided here and acked.
 */
export async function persistRecording(payload: unknown): Promise<"stored" | "dropped"> {
	const parsed = runSchema.safeParse(payload);
	if (!parsed.success) {
		// fails the same way on every redelivery, so ack and forget it
		const why = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
		logger.warn(`[recordings] dropped a malformed run: ${why.join("; ")}`, "RECORDINGS");
		return "dropped";
	}
	const run = parsed.data;
	if (!(await shouldStore(run))) return "dropped";

	// span times are `performance.now()` readings; this puts them on the wall clock
	const wall = (t: number) => new Date(run.startedAtWallMs + (t - run.perfOrigin));
	await db.transaction(async (tx) => {
		// the run id is the key: a redelivered run writes nothing twice
		await tx
			.insert(traceRunsEntity)
			.values({
				id: run.runId,
				projectId: run.projectId,
				routeId: run.routeId,
				workflowId: run.workflowId,
				routeVersion: run.routeVersion,
				workflowVersion: run.workflowVersion,
				startedAt: new Date(run.startedAtWallMs),
				endedAt: wall(run.endedAt),
				outcome: run.outcome,
				statusCode: run.statusCode,
				truncated: run.truncated ?? false,
				droppedSpans: run.droppedSpans ?? 0,
				parentRunId: run.parentRunId,
				parentSeq: run.parentSeq,
				spanCount: run.spans.length,
				metadata: run.metadata,
			})
			.onConflictDoNothing();
		if (!run.spans.length) return;
		await tx
			.insert(traceSpansEntity)
			.values(
				run.spans.map((span) => ({
					runId: run.runId,
					seq: span.seq,
					parentSeq: span.parentSeq,
					blockId: span.blockId,
					blockType: span.blockType,
					blockName: span.blockName,
					customBlockId: span.customBlockId,
					middleware: span.middleware as TraceRunPayload["spans"][number]["middleware"],
					startedAt: wall(span.startedAt),
					endedAt: wall(span.endedAt),
					outcome: span.outcome,
					branch: span.branch,
					error: span.error,
					input: span.input,
					output: span.output,
					truncated: span.truncated ?? false,
					metadata: span.metadata,
				})),
			)
			.onConflictDoNothing();
	});
	return "stored";
}

/**
 * The run's route or workflow must belong to its project, always. A test run
 * (#627) is stored whatever `recordExecution` says; any other run only while
 * recording is still on — it may have been switched off since the run.
 */
async function shouldStore(run: {
	projectId: string;
	routeId?: string;
	workflowId?: string;
	metadata?: { source: "test" };
}) {
	const [row] = run.routeId
		? await db
				.select({ on: routesEntity.recordExecution })
				.from(routesEntity)
				.where(and(eq(routesEntity.id, run.routeId), eq(routesEntity.projectId, run.projectId)))
		: await db
				.select({ on: workflowsEntity.recordExecution })
				.from(workflowsEntity)
				.where(
					and(
						eq(workflowsEntity.id, run.workflowId!),
						eq(workflowsEntity.projectId, run.projectId),
					),
				);
	if (!row) return false;
	return run.metadata?.source === "test" || Boolean(row.on);
}

/**
 * Deletes runs older than `maxAgeDays`, a batch at a time so one tick never
 * holds a long lock. Spans go with their run (FK cascade). Idempotent: a missed
 * tick is covered by the next one.
 */
export async function deleteExpiredRecordings(maxAgeDays = RECORDING_MAX_AGE_DAYS) {
	const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60_000);
	let deleted = 0;
	for (;;) {
		const batch = db
			.select({ id: traceRunsEntity.id })
			.from(traceRunsEntity)
			.where(lt(traceRunsEntity.startedAt, cutoff))
			.limit(RETENTION_BATCH);
		const rows = await db
			.delete(traceRunsEntity)
			.where(inArray(traceRunsEntity.id, batch))
			.returning({ id: traceRunsEntity.id });
		deleted += rows.length;
		if (rows.length < RETENTION_BATCH) break;
	}
	if (deleted) {
		logger.info(
			`[recordings] deleted ${deleted} run(s) older than ${maxAgeDays} days`,
			"RECORDINGS",
		);
	}
	return deleted;
}
