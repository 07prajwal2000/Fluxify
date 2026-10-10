import { logger } from "@fluxify/common";
import { ensureStreamOnce, publishToStream } from "@fluxify/common/nats";
import { natsConnection, natsName, natsStreamSpec } from "../../db/nats";
import type { FluxifyEnv } from "../../lib/env";
import { JOBS_STREAM_SPEC, jobSubject } from "./subjects";
import type { JobEnvelope } from "./types";

export type JobInput = Omit<JobEnvelope, "id" | "enqueuedAt"> & {
	/** Supply one to make a retry of the same logical work collapse. */
	id?: string;
};

/**
 * Publishes to JetStream, so the job outlives the process that queued it. The
 * message id is the broker's dedupe key within its duplicate window: publishing
 * the same id twice (a retried request, a redelivered upstream message) enqueues
 * the work once.
 *
 * Throws rather than logging: the caller asked for durable work, and a queue
 * that swallows failures is worse than one that refuses them.
 *
 * `env` defaults to this process's own (#732), so work a dev worker queues stays dev.
 */
export async function enqueueJob(input: JobInput, env?: FluxifyEnv): Promise<JobEnvelope> {
	const job: JobEnvelope = {
		...input,
		id: input.id ?? crypto.randomUUID(),
		enqueuedAt: new Date().toISOString(),
	};
	const subject = natsName(jobSubject(job.projectId, job.kind), env);

	// the publisher can be first: no worker may have created the stream yet
	const nc = natsConnection();
	await ensureStreamOnce(nc, natsStreamSpec(JOBS_STREAM_SPEC, env));
	await publishToStream(nc, subject, job, { msgId: job.id });

	logger.debug(`[jobs] queued ${subject} (${job.target})`, "JOBS.publish");
	return job;
}
