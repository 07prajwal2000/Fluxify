/**
 * The seam between a graph and whatever queue the host runs.
 *
 * `packages/blocks` must not know about NATS — it runs inside the isolated
 * execution process, which owns no connections. The host registers an enqueuer
 * at startup and the generated code calls `lib.enqueue`, exactly the way
 * `setBlocksExecutor` inverts route execution.
 */

import { parseDurationMs } from "@fluxify/common/schedule";

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
	/** Set when the caller needs the id up front — a scheduled run's handle. */
	id?: string;
	/** ISO time a Trigger Workflow run is held until. Unset runs it now. */
	runAt?: string;
};

export type JobEnqueuer = (job: JobRequest) => void;

/** The job kind a Trigger Workflow block travels under. */
export const TRIGGER_WORKFLOW_JOB = "trigger-workflow";

/** Drops a run a Trigger Workflow block scheduled for later; `target` is its id. */
export const CANCEL_SCHEDULE_JOB = "cancel-schedule";

const SCHEDULE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Scheduled run ids are UUIDs, and nothing else is accepted: the id becomes a
 * broker subject, and a `*` or `>` there would cancel every pending run.
 */
export function isScheduleId(id: unknown): id is string {
	return typeof id === "string" && SCHEDULE_ID.test(id);
}

let enqueuer: JobEnqueuer | undefined;

/**
 * How far ahead a run may be scheduled. A deployment setting, not a project
 * one — it bounds how long the broker holds messages on the operator's behalf.
 */
let scheduleHorizonMs: number | undefined;

/** Called once by the host process. Pass nothing to detach (tests, shutdown). */
export function setScheduleHorizon(next?: number) {
	scheduleHorizonMs = next;
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Reads a "run at" value: a `Date`, an ISO time with its offset, or a delay
 * from now in the same `10m` / `24h` / `1h30m` form schedules use. Anything else
 * throws — `new Date()` alone would accept "tomorrow-ish" strings and guess.
 */
export function resolveRunAt(value: unknown, now = Date.now()): Date {
	const at = toDate(value, now);
	if (!at || Number.isNaN(at.getTime()))
		throw new Error(
			`Run at must be an ISO time like 2026-01-01T09:00:00Z or a delay like 10m or 24h — got ${JSON.stringify(value)}`,
		);
	if (scheduleHorizonMs && at.getTime() - now > scheduleHorizonMs)
		throw new Error(
			`Run at ${at.toISOString()} is further ahead than this deployment allows (${scheduleHorizonMs / 3_600_000}h). ` +
				`Schedule something closer, or ask your administrator to raise the limit.`,
		);
	return at;
}

function toDate(value: unknown, now: number) {
	if (value instanceof Date) return value;
	if (typeof value !== "string") return undefined;
	const text = value.trim();
	if (ISO_TIME.test(text)) return new Date(text);
	try {
		return new Date(now + parseDurationMs(text));
	} catch {
		return undefined;
	}
}

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
		throw new Error(`No job queue is configured — cannot queue ${job.kind} "${job.target}"`);
	}
	enqueuer(job);
}
