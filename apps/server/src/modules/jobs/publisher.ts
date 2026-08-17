import { logger } from "@fluxify/common";
import { StringCodec } from "nats";
import { natsConnection } from "../../db/nats";
import { jobSubject } from "./subjects";
import type { JobEnvelope } from "./types";

const sc = StringCodec();

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
 */
export async function enqueueJob(input: JobInput): Promise<JobEnvelope> {
	const job: JobEnvelope = {
		...input,
		id: input.id ?? crypto.randomUUID(),
		enqueuedAt: new Date().toISOString(),
	};
	const subject = jobSubject(job.projectId, job.kind);

	await natsConnection()
		.jetstream()
		.publish(subject, sc.encode(JSON.stringify(job)), { msgID: job.id });

	logger.debug(`[jobs] queued ${subject} (${job.target})`, "JOBS.publish");
	return job;
}
