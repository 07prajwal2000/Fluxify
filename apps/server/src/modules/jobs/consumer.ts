import { logger } from "@fluxify/common";
import {
	consumeQueue,
	dropWildcardConsumers,
	ensureConsumer,
	ensureStream,
	type QueueConsumer,
} from "@fluxify/common/nats";
import { natsConnection, natsName, natsStreamSpec } from "../../db/nats";
import type { FluxifyEnv } from "../../lib/env";
import {
	ALL_PROJECTS,
	JOBS_STREAM,
	JOBS_STREAM_SPEC,
	jobConsumerName,
	jobFilter,
	jobKindsForMode,
} from "./subjects";
import type { JobEnvelope } from "./types";

/**
 * The job worker's transport half: one durable pull consumer per project and
 * job kind. Running the work is the caller's `handle` — this file only decides
 * what gets acked, retried or dropped.
 *
 * Per *project*, not per worker: a catch-all deployment serves many projects and
 * cannot hold a wildcard consumer, because a work-queue stream refuses a filter
 * that overlaps another consumer's and every project that claims a node of its
 * own would be locked out (see `jobConsumerName`). So it is told which projects
 * it serves, one at a time, as their artifacts arrive — and two workers serving
 * the same project simply share the durable and split the work.
 *
 * A work-queue stream removes a message once it is acked, so a restart never
 * replays yesterday's jobs. Everything below is tunable because a queued custom
 * block and a nightly cron want very different ack waits.
 */

export type JobWorkerOptions = {
	/** route | workflow | both — decides which job kinds this worker takes. */
	mode: string;
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
	/** Whose jobs (#732); this process's environment unless a test says otherwise. */
	env?: FluxifyEnv;
};

export interface JobWorker {
	/** Starts consuming one project's jobs. Idempotent. */
	serve(projectId: string): Promise<void>;
	/** Stops consuming one project's jobs — it was deleted, or moved away. */
	unserve(projectId: string): Promise<void>;
	/** Which projects are being consumed, for the deployment's own logging. */
	projects(): string[];
	stop(): Promise<void>;
}

const DEFAULTS = {
	concurrency: 5,
	ackWaitMs: 5 * 60_000,
	maxDeliver: 5,
	retryDelayMs: 10_000,
	maxAgeMs: JOBS_STREAM_SPEC.maxAgeMs,
};

export function createJobWorker(options: JobWorkerOptions): JobWorker {
	const config: Required<Omit<JobWorkerOptions, "env">> = {
		...DEFAULTS,
		...stripUndefined(options),
		mode: options.mode,
		handle: options.handle,
	};
	const kinds = jobKindsForMode(config.mode);
	const streamName = natsName(JOBS_STREAM, options.env);
	const served = new Map<string, QueueConsumer[]>();
	let stream: Promise<void> | undefined;

	/**
	 * The stream is provisioned once per process, and the wildcard sweep with it:
	 * a durable left by an older build would refuse every consumer below and no
	 * worker on this instance could ever boot again.
	 */
	function ensureJobsStream() {
		stream ??= (async () => {
			const nc = natsConnection();
			await ensureStream(nc, {
				...natsStreamSpec(JOBS_STREAM_SPEC, options.env),
				maxAgeMs: config.maxAgeMs,
			});
			await dropWildcardConsumers(nc, streamName);
		})();
		return stream;
	}

	async function consume(projectId: string, kind: string) {
		const nc = natsConnection();
		const durable = jobConsumerName(projectId, kind);
		await ensureConsumer(nc, streamName, {
			durable,
			filterSubjects: [natsName(jobFilter(projectId, kind), options.env)],
			ackWaitMs: config.ackWaitMs,
			maxDeliver: config.maxDeliver,
			maxAckPending: config.concurrency,
		});
		return consumeQueue<JobEnvelope>(
			nc,
			streamName,
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
	}

	return {
		async serve(projectId: string) {
			// Reserved before the first await: two artifacts for a new project
			// arrive back to back, and both would otherwise start a consumer.
			if (served.has(projectId)) return;
			served.set(projectId, []);
			try {
				await ensureJobsStream();
				const consumers: QueueConsumer[] = [];
				for (const kind of kinds) consumers.push(await consume(projectId, kind));
				served.set(projectId, consumers);
				logger.info(
					`[jobs] worker (${config.mode}) serving ${projectId}: ${kinds.join(", ")}`,
					"JOBS",
				);
			} catch (error) {
				// Left unserved so the next artifact for this project retries.
				await Promise.allSettled((served.get(projectId) ?? []).map((consumer) => consumer.stop()));
				served.delete(projectId);
				throw error;
			}
		},

		async unserve(projectId: string) {
			const consumers = served.get(projectId);
			if (!consumers) return;
			served.delete(projectId);
			await Promise.allSettled(consumers.map((consumer) => consumer.stop()));
			logger.info(`[jobs] worker stopped serving ${projectId}`, "JOBS");
		},

		projects: () => [...served.keys()],

		async stop() {
			const consumers = [...served.values()].flat();
			served.clear();
			await Promise.allSettled(consumers.map((consumer) => consumer.stop()));
		},
	};
}

/**
 * One project's jobs, for a deployment that serves exactly one. A catch-all
 * worker calls `createJobWorker` and serves each project it discovers instead —
 * `*` has no consumer of its own.
 */
export async function startJobWorker(
	options: JobWorkerOptions & { projectId: string },
): Promise<JobWorker> {
	if (options.projectId === ALL_PROJECTS)
		throw new Error(
			"startJobWorker serves one project — use createJobWorker() and serve() each project a catch-all worker discovers",
		);
	const worker = createJobWorker(options);
	await worker.serve(options.projectId);
	return worker;
}

/** A handler can opt a failure out of retries by naming it. */
function isPermanent(error: unknown) {
	return (error as Error)?.name === "UnknownJobKindError";
}

function stripUndefined<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
