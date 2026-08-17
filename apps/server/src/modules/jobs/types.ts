/**
 * One queued unit of work, as it travels on the wire.
 *
 * Deliberately kind-agnostic: a queued custom block, a cron firing, a workflow
 * step and a scheduled job are all this shape, so they all share one stream and
 * one worker. `kind` is the only thing that decides how `target` and `payload`
 * are read — see the handler registry.
 */
export type JobEnvelope = {
	/** Dedupe key on the broker and correlation id in logs. */
	id: string;
	kind: string;
	projectId: string;
	target: string;
	payload?: unknown;
	origin?: Record<string, unknown>;
	enqueuedAt: string;
	/** Delivery attempt, filled in by the consumer, not the publisher. */
	attempt?: number;
};

export type JobHandler = (job: JobEnvelope) => Promise<void>;
