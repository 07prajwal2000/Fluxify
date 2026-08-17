/**
 * The seam between a graph and whatever queue the host runs.
 *
 * `packages/blocks` must not know about NATS — it runs inside the isolated
 * execution process, which owns no connections. The host registers an enqueuer
 * at startup and the generated code calls `lib.enqueue`, exactly the way
 * `setBlocksExecutor` inverts route execution.
 */

/** One unit of queued work. `kind` decides how a consumer reads `target`. */
export type JobRequest = {
	/** "custom-block" today; crons, workflows and schedules share this queue. */
	kind: string;
	projectId: string;
	/** What to run — a custom block's name, a route id, a workflow key. */
	target: string;
	/** Must be JSON-serializable: it crosses a process and a broker. */
	payload?: unknown;
	/** Where it was queued from, for correlation in traces and logs. */
	origin?: {
		blockId?: string;
		route?: string;
		apiId?: string;
	};
};

export type JobEnqueuer = (job: JobRequest) => void;

let enqueuer: JobEnqueuer | undefined;

/** Called once by the host process. Pass nothing to detach (tests, shutdown). */
export function setJobEnqueuer(next?: JobEnqueuer) {
	enqueuer = next;
}

export function jobQueueAvailable() {
	return enqueuer !== undefined;
}

/**
 * Throws when no queue is wired. Dropping the job silently would be worse: the
 * caller has already moved on believing the work is durable.
 */
export function enqueueJob(job: JobRequest) {
	if (!enqueuer) {
		throw new Error(
			`No job queue is configured — cannot queue ${job.kind} "${job.target}"`,
		);
	}
	enqueuer(job);
}
