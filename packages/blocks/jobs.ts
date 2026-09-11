/**
 * The seam between a graph and whatever queue the host runs.
 *
 * `packages/blocks` must not know about NATS — it runs inside the isolated
 * execution process, which owns no connections. The host registers an enqueuer
 * at startup and the generated code calls `lib.enqueue`, exactly the way
 * `setBlocksExecutor` inverts route execution.
 */

/** Per-job override of the consumer's retry defaults. Unset fields keep them. */
export type RetryPolicy = {
	/** Runs before the job is dropped, 1 to 5. */
	maxAttempts?: number;
	/** Wait before the first retry; doubles after each failed attempt. */
	retryDelayMs?: number;
};

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
	retry?: RetryPolicy;
};

export type JobEnqueuer = (job: JobRequest) => void;

/** The job kind a Trigger Workflow block travels under. */
export const TRIGGER_WORKFLOW_JOB = "trigger-workflow";

let enqueuer: JobEnqueuer | undefined;

/**
 * The largest payload one trigger may carry, per project.
 *
 * Enforced here rather than at the broker because here is the only place the
 * failure is visible: the graph's error handler catches it and the calling
 * route answers with something. A check on the supervisor would fire after the
 * block has already moved on, so the run would look successful and the workflow
 * would simply never start.
 */
let payloadLimit: ((projectId: string) => number) | undefined;

/** Called once by the host process. Pass nothing to detach (tests, shutdown). */
export function setTriggerPayloadLimit(next?: (projectId: string) => number) {
	payloadLimit = next;
}

/**
 * Throws when the payload is over the project's cap.
 *
 * The size is measured on the JSON the broker would actually carry, not on the
 * object — a 40-character string of emoji is not 40 bytes, and the limit exists
 * to protect the broker.
 */
export function assertTriggerPayloadSize(projectId: string, payload: unknown) {
	const limit = payloadLimit?.(projectId);
	if (!limit) return;
	const bytes =
		payload === undefined ? 0 : new TextEncoder().encode(JSON.stringify(payload) ?? "").length;
	if (bytes <= limit) return;
	throw new Error(
		`Trigger payload is ${bytes} bytes, over this project's ${limit} byte limit. ` +
			`Pass a reference instead of the data, or use a dedicated trigger with an integration for payloads this size.`,
	);
}

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
