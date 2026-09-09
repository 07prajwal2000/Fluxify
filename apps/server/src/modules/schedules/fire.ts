import { logger } from "@fluxify/common";
import { consumeQueue, ensureConsumer, type QueueConsumer } from "@fluxify/common/nats";
import type { TriggerEvent } from "@fluxify/blocks";
import { natsConnection } from "../../db/nats";
import { enqueueJob } from "../jobs/publisher";
import { WORKFLOW_JOB } from "../jobs/subjects";
import type { TriggerBatch } from "../triggers/types";
import { ensureSchedulesStream } from "./reconciler";
import {
	SCHEDULES_STREAM,
	fireConsumerName,
	projectFireFilter,
} from "./subjects";
import { isScheduleFireBody, type ScheduleFireBody } from "./types";

/**
 * Turning a fire into work.
 *
 * NATS does the timekeeping but only knows how to produce a message: at each
 * due instant it copies the schedule's body onto the fire subject, and that is
 * the end of its involvement. This consumer is what notices and queues the
 * workflow. Without it, fires accumulate on the stream and nothing ever runs.
 *
 * It lives on the worker rather than beside the reconciler on purpose. The
 * worker fleet is the always-on tier: a control-plane node going down should
 * delay schedule *edits*, not stop schedules from firing.
 */

export type FireConsumerOptions = {
	/** Project this deployment serves, or "*" for every project. */
	projectId: string;
	/** Attempts before a fire is dropped. */
	maxDeliver?: number;
	/** Wait before a failed fire is redelivered. */
	retryDelayMs?: number;
};

export async function startFireConsumer(
	options: FireConsumerOptions,
): Promise<QueueConsumer> {
	const nc = natsConnection();
	await ensureSchedulesStream();

	const durable = fireConsumerName(options.projectId);
	await ensureConsumer(nc, SCHEDULES_STREAM, {
		durable,
		filterSubjects: [projectFireFilter(options.projectId)],
		// Enqueueing is a publish and an ack; nothing here waits on the workflow.
		ackWaitMs: 30_000,
		maxDeliver: options.maxDeliver ?? 5,
		maxAckPending: 64,
	});

	const consumer = await consumeQueue<ScheduleFireBody>(
		nc,
		SCHEDULES_STREAM,
		durable,
		async (message) => {
			if (!isScheduleFireBody(message.data))
				throw new Error(`malformed schedule fire on ${message.subject}`);
			// The stream's own timestamp, not `new Date()`: it is the same value on
			// every redelivery, which is what makes the job id below collapse a
			// redelivered fire into one run instead of one run per attempt.
			await enqueueFire(message.data, message.msg.timestamp);
		},
		{
			maxAttempts: options.maxDeliver ?? 5,
			retryDelayMs: options.retryDelayMs ?? 10_000,
			// A body that will not parse fails identically forever.
			isPermanent: (error) => String(error).includes("malformed schedule fire"),
		},
	);

	logger.info(
		`[schedules] fire consumer listening on ${projectFireFilter(options.projectId)}`,
		"SCHEDULES",
	);
	return consumer;
}

/**
 * One fire, one job per linked workflow.
 *
 * A job id is `<triggerId>:<firedAt>:<workflowId>`, so a redelivered fire — and
 * a fire seen by both a project worker and a catch-all worker, which this
 * stream's retention permits — enqueues each workflow exactly once inside the
 * jobs stream's dedupe window. The workflow id has to be in there: without it
 * the second workflow's job would be deduped away as a copy of the first.
 *
 * A cron is a single event and never batches. There is no stream to accumulate
 * from, so a workflow that has 500 rows to process queries 500 rows itself.
 */
export async function enqueueFire(body: ScheduleFireBody, firedAt: string) {
	const batch: TriggerBatch = {
		triggerId: body.triggerId,
		source: "schedule",
		events: [
			{
				data: body.payload ?? null,
				meta: {
					id: `${body.triggerId}:${firedAt}`,
					receivedAt: firedAt,
					source: "schedule",
				},
			} satisfies TriggerEvent,
		],
	};

	// Sequential rather than Promise.all: a throw here fails the fire and the
	// broker redelivers it, and the ids above make the jobs already enqueued
	// no-ops on the retry. Racing them would only obscure which one failed.
	const jobs = [];
	for (const workflowId of body.workflowIds) {
		const job = await enqueueJob({
			id: `${body.triggerId}:${firedAt}:${workflowId}`,
			kind: WORKFLOW_JOB,
			projectId: body.projectId,
			target: workflowId,
			payload: batch,
			origin: { triggerId: body.triggerId, source: "schedule", firedAt },
		});
		jobs.push(job);
	}
	logger.debug(
		`[schedules] fire ${body.triggerId} -> ${jobs.length} workflow(s)`,
		"SCHEDULES",
	);
	return jobs;
}
