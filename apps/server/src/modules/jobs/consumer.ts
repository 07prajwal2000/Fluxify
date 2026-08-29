import { logger } from "@fluxify/common";
import { consumeQueue, ensureStreamConsumer } from "@fluxify/common/nats";
import { natsConnection } from "../../db/nats";
import {
	JOBS_STREAM,
	JOBS_SUBJECTS,
	jobConsumerName,
	projectJobFilter,
} from "./subjects";
import type { JobEnvelope } from "./types";

/**
 * The job worker's transport half: one durable pull consumer on the shared
 * stream, filtered to this deployment's project. Running the work is the
 * caller's `handle` — this file only decides what gets acked, retried or
 * dropped.
 *
 * A work-queue stream removes a message once it is acked, so a restart never
 * replays yesterday's jobs. Everything below is tunable because a queued custom
 * block and a nightly cron want very different ack waits.
 */

export type JobWorkerOptions = {
	/** Project this deployment serves, or "*" for every project. */
	projectId: string;
	/** Runs the job. Resolve to ack, reject to retry. */
	handle: (job: JobEnvelope) => Promise<void>;
	/** Jobs in flight at once. */
	concurrency?: number;
	/** How long a job may run before the broker assumes the worker died. */
	ackWaitMs?: number;
	/** Attempts before the job is dropped and logged as dead. */
	maxDeliver?: number;
	/** Wait before a failed job is redelivered. */
	retryDelayMs?: number;
	/** How long an unclaimed job stays on the stream. */
	maxAgeMs?: number;
};

const DEFAULTS = {
	concurrency: 5,
	ackWaitMs: 5 * 60_000,
	maxDeliver: 5,
	retryDelayMs: 10_000,
	maxAgeMs: 7 * 24 * 60 * 60_000,
};

let running = false;

export async function startJobWorker(options: JobWorkerOptions) {
	if (running) return;
	const config: Required<JobWorkerOptions> = {
		...DEFAULTS,
		...stripUndefined(options),
		projectId: options.projectId,
		handle: options.handle,
	};
	const nc = natsConnection();
	const durable = jobConsumerName(config.projectId);

	await ensureStreamConsumer(
		nc,
		{
			name: JOBS_STREAM,
			subjects: [JOBS_SUBJECTS],
			// a job is work, not history: once acked it leaves the stream
			retention: "workqueue",
			maxAgeMs: config.maxAgeMs,
			// publisher dedupe window for `msgID`
			duplicateWindowMs: 2 * 60_000,
		},
		{
			durable,
			filterSubjects: [projectJobFilter(config.projectId)],
			ackWaitMs: config.ackWaitMs,
			maxDeliver: config.maxDeliver,
			maxAckPending: config.concurrency,
		},
	);

	await consumeQueue<JobEnvelope>(
		nc,
		JOBS_STREAM,
		durable,
		async (message) => {
			message.data.attempt = message.attempt;
			await config.handle(message.data);
		},
		{
			concurrency: config.concurrency,
			failure: "retry",
			maxAttempts: config.maxDeliver,
			retryDelayMs: config.retryDelayMs,
			isPermanent,
		},
	);
	running = true;
	logger.info(
		`[jobs] worker listening on ${projectJobFilter(config.projectId)}`,
		"JOBS",
	);
}

/** A handler can opt a failure out of retries by naming it. */
function isPermanent(error: unknown) {
	return (error as Error)?.name === "UnknownJobKindError";
}

function stripUndefined<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(value).filter(([, v]) => v !== undefined),
	) as Partial<T>;
}
