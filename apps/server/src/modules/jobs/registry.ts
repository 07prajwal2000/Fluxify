import type { JobEnvelope, JobHandler } from "./types";

/**
 * What each job kind means, on whichever process actually runs the work.
 *
 * Kept apart from the consumer on purpose: the transport (stream, acks,
 * redelivery) belongs to the process that owns the NATS connection, while the
 * handlers belong to the process that owns user code. Adding a cron or workflow
 * kind later is one `registerJobHandler` call and no transport changes.
 */

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(kind: string, handler: JobHandler) {
	handlers.set(kind, handler);
}

export function jobKinds() {
	return [...handlers.keys()];
}

/** Thrown for a kind nobody handles — retrying that can never succeed. */
export class UnknownJobKindError extends Error {
	constructor(kind: string) {
		super(`No handler registered for job kind "${kind}"`);
		this.name = "UnknownJobKindError";
	}
}

export async function runJob(job: JobEnvelope) {
	const handler = handlers.get(job.kind);
	if (!handler) throw new UnknownJobKindError(job.kind);
	await handler(job);
}
