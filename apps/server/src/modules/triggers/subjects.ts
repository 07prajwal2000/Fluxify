import type { StreamSpec } from "@fluxify/common/nats";

/**
 * Naming for trigger traffic.
 *
 * Triggers get their own stream rather than more subjects on `FLUXIFY_JOBS`.
 * Two reasons: a trigger backlog must not crowd out the queued custom blocks a
 * route is waiting on, and a work-queue stream forbids overlapping consumer
 * filters — with one consumer per trigger on a shared stream, every new trigger
 * would be one more chance to collide with the job worker's filters. Separate
 * streams make that impossible instead of merely unlikely.
 *
 * Subjects are `fluxify.triggers.<projectId>.<source>`, where source is either
 * a trigger's id or the literal `internal`. Project comes first so a worker
 * filters on its own tenant with one wildcard.
 */

export const TRIGGERS_STREAM = "FLUXIFY_TRIGGERS";

const SUBJECT_ROOT = "fluxify.triggers";
/** Everything the stream captures. */
export const TRIGGERS_SUBJECTS = `${SUBJECT_ROOT}.>`;

/**
 * The stream's settings, shared by the worker that consumes it and the admin
 * that publishes to it. Either may be first, so both create it: a publish to a
 * stream nobody created fails with a misleading `JetStreamNotEnabled` (#587).
 */
export const TRIGGERS_STREAM_SPEC = {
	name: TRIGGERS_STREAM,
	subjects: [TRIGGERS_SUBJECTS],
	// an event is work, not history: once acked it leaves the stream
	retention: "workqueue",
	maxAgeMs: 7 * 24 * 60 * 60_000,
	duplicateWindowMs: 2 * 60_000,
} satisfies StreamSpec;

/**
 * The one subject the Trigger Workflow block and the portal's Run button
 * publish to. It carries `{ workflowId, data }` — the workflow is named in the
 * message rather than in the subject, because this path has no trigger row to
 * take an id from and one consumer per workflow would be a consumer per
 * workflow to provision.
 */
export const INTERNAL_SOURCE = "internal";

/** Serves every project — the catch-all worker deployment. */
export const ALL_PROJECTS = "*";

export const internalSubject = (projectId: string) =>
	`${SUBJECT_ROOT}.${projectId}.${INTERNAL_SOURCE}`;

/** A trigger row's own subject. One consumer reads it, so filters are disjoint
 *  by construction. */
export const triggerSubject = (projectId: string, triggerId: string) =>
	`${SUBJECT_ROOT}.${projectId}.${triggerId}`;

/**
 * Durable names. Replicas of the same deployment share one, which is what makes
 * them compete for the same messages instead of each running every event.
 * Consumer names allow no dots or wildcards.
 */
const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

/**
 * One project's internal subject. Never `*`: this stream is work-queue, so a
 * wildcard consumer overlaps every per-project one and JetStream refuses the
 * second — a catch-all worker serves each project it discovers instead.
 */
export const internalConsumerName = (projectId: string) => {
	if (projectId === ALL_PROJECTS)
		throw new Error(
			"an internal trigger consumer serves one project — a catch-all worker serves each project it discovers",
		);
	return `fluxify_triggers_${sanitize(projectId)}_internal`;
};

export const triggerConsumerName = (triggerId: string) => `fluxify_trigger_${sanitize(triggerId)}`;
