import { isScheduleId } from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import { publishSchedule, purgeSchedule } from "@fluxify/common/nats";
import { natsConnection, natsName } from "../../db/nats";
import type { FluxifyEnv } from "../../lib/env";
import type { JobEnvelope } from "../jobs/types";
import { fireInternalTrigger } from "../triggers/publisher";
import { ensureSchedulesStream } from "./reconciler";
import { delayedSubject, fireSubject, SCHEDULES_STREAM } from "./subjects";
import type { DelayedRunBody } from "./types";

/**
 * One-time runs a Trigger Workflow block holds for later.
 *
 * NATS keeps the time, so a held run survives any restart and fires once. There
 * is no row and no list: the block hands its caller the id, and that id is the
 * only handle anyone gets.
 */

/** Holds the run on its own `@at` schedule. */
export async function scheduleWorkflowRun(job: JobEnvelope) {
	// The child is the untrusted half: check what becomes a subject and a header.
	assertRunId(job.id);
	if (!job.runAt || Number.isNaN(Date.parse(job.runAt)))
		throw new Error(`invalid run time ${JSON.stringify(job.runAt)}`);
	await ensureSchedulesStream();

	const body: DelayedRunBody = {
		runId: job.id,
		projectId: job.projectId,
		workflowId: job.target,
		data: job.payload,
		origin: job.origin,
		retry: job.retry,
	};
	await publishSchedule(natsConnection(), natsName(delayedSubject(job.projectId, job.id)), body, {
		specification: `@at ${job.runAt}`,
		target: natsName(fireSubject(job.projectId, job.id)),
	});
	logger.debug(`[schedules] run ${job.id} -> ${job.target} at ${job.runAt}`, "SCHEDULES");
}

/** Idempotent: a run that already fired, or never existed, purges nothing. */
export async function cancelScheduledRun(projectId: string, runId: string) {
	assertRunId(runId);
	const nc = natsConnection();
	const stream = natsName(SCHEDULES_STREAM);
	await purgeSchedule(nc, stream, natsName(delayedSubject(projectId, runId)));
	// A fire generated but not yet picked up would otherwise still start the run.
	await purgeSchedule(nc, stream, natsName(fireSubject(projectId, runId)));
	logger.debug(`[schedules] cancelled run ${runId}`, "SCHEDULES");
}

/**
 * The fire: exactly what running now would have published. The run id is the
 * message id, so a redelivered fire still starts one run.
 */
export function fireDelayedRun({ runId, ...message }: DelayedRunBody, env?: FluxifyEnv) {
	return fireInternalTrigger({ id: runId, ...message }, env);
}

function assertRunId(id: string) {
	if (!isScheduleId(id)) throw new Error(`invalid scheduled run id ${JSON.stringify(id)}`);
}
