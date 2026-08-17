import { logger } from "@fluxify/common";
import { AckPolicy, RetentionPolicy, StringCodec, type JsMsg } from "nats";
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

const sc = StringCodec();
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
	const jsm = await nc.jetstreamManager();

	await ensureStream(jsm, config.maxAgeMs);
	await ensureConsumer(jsm, config);

	const consumer = await nc
		.jetstream()
		.consumers.get(JOBS_STREAM, jobConsumerName(config.projectId));
	const messages = await consumer.consume({ max_messages: config.concurrency });
	running = true;
	logger.info(
		`[jobs] worker listening on ${projectJobFilter(config.projectId)}`,
		"JOBS",
	);

	void (async () => {
		const inFlight = new Set<Promise<void>>();
		for await (const message of messages) {
			// Bound the concurrency ourselves: `max_messages` limits what the server
			// pushes, not what we start.
			if (inFlight.size >= config.concurrency) await Promise.race(inFlight);
			const task = settle(message, config).finally(() => inFlight.delete(task));
			inFlight.add(task);
		}
		await Promise.allSettled(inFlight);
	})();
}

async function settle(message: JsMsg, config: Required<JobWorkerOptions>) {
	let job: JobEnvelope | undefined;
	try {
		job = JSON.parse(sc.decode(message.data)) as JobEnvelope;
		job.attempt = message.info.redeliveryCount;
		await config.handle(job);
		message.ack();
	} catch (error) {
		const label = job ? `${job.kind}/${job.target}` : message.subject;
		// Unparseable, or a kind nobody handles: retrying changes nothing.
		if (!job || isPermanent(error)) {
			logger.error(`[jobs] dropping ${label}: ${String(error)}`, "JOBS");
			return message.term();
		}
		if (message.info.redeliveryCount >= config.maxDeliver) {
			logger.error(
				`[jobs] ${label} failed ${message.info.redeliveryCount} times, giving up: ${String(error)}`,
				"JOBS",
			);
			return message.term();
		}
		logger.warn(
			`[jobs] ${label} failed (attempt ${message.info.redeliveryCount}), retrying: ${String(error)}`,
			"JOBS",
		);
		message.nak(config.retryDelayMs);
	}
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

async function ensureStream(jsm: any, maxAgeMs: number) {
	const spec = {
		name: JOBS_STREAM,
		subjects: [JOBS_SUBJECTS],
		// a job is work, not history: once acked it leaves the stream
		retention: RetentionPolicy.Workqueue,
		max_age: maxAgeMs * 1_000_000, // ns
		// publisher dedupe window for `msgID`
		duplicate_window: 2 * 60 * 1_000_000_000,
	};
	try {
		await jsm.streams.add(spec);
	} catch {
		await jsm.streams.update(JOBS_STREAM, {
			subjects: spec.subjects,
			max_age: spec.max_age,
		});
	}
}

async function ensureConsumer(jsm: any, config: Required<JobWorkerOptions>) {
	const spec = {
		durable_name: jobConsumerName(config.projectId),
		ack_policy: AckPolicy.Explicit,
		ack_wait: config.ackWaitMs * 1_000_000, // ns
		max_deliver: config.maxDeliver,
		filter_subject: projectJobFilter(config.projectId),
		max_ack_pending: config.concurrency,
	};
	try {
		await jsm.consumers.add(JOBS_STREAM, spec);
	} catch {
		// already exists — pick up changed limits without losing pending work
		await jsm.consumers.update(JOBS_STREAM, spec.durable_name, {
			ack_wait: spec.ack_wait,
			max_deliver: spec.max_deliver,
			max_ack_pending: spec.max_ack_pending,
		});
	}
}
