/**
 * Naming for the job queue.
 *
 * ONE stream carries every kind of background work — queued custom blocks
 * today, crons/workflows/scheduled jobs later. A stream per feature would mean
 * a pile of mostly-idle streams and consumers to operate, so kinds are a subject
 * token instead: adding one costs a handler registration and nothing else.
 *
 * Subjects are `fluxify.jobs.<projectId>.<kind>`. Project comes first so a
 * worker can filter on its own tenant with a single wildcard, which is also what
 * keeps consumers non-overlapping — a work-queue stream requires that.
 */

export const JOBS_STREAM = "FLUXIFY_JOBS";

const SUBJECT_ROOT = "fluxify.jobs";
/** everything the job worker can consume */
export const JOBS_SUBJECTS = `${SUBJECT_ROOT}.>`;
/** serves every project — the catch-all worker deployment */
export const ALL_PROJECTS = "*";

/** Job kinds this build knows. `custom-block` is named by @fluxify/blocks. */
export const CUSTOM_BLOCK_JOB = "custom-block";
export const WORKFLOW_JOB = "workflow";

export const WORKER_MODES = ["route", "workflow", "both"] as const;
export type WorkerMode = (typeof WORKER_MODES)[number];

/**
 * What each mode consumes.
 *
 * `custom-block` belongs to every mode, including `route`: those jobs are
 * enqueued *by* routes, so a route-only worker still needs the jobs consumer.
 * Mode selects which kinds you subscribe to, never whether a consumer exists.
 */
const KINDS_BY_MODE: Record<WorkerMode, readonly string[]> = {
	route: [CUSTOM_BLOCK_JOB],
	workflow: [CUSTOM_BLOCK_JOB, WORKFLOW_JOB],
	both: [CUSTOM_BLOCK_JOB, WORKFLOW_JOB],
};

/** Artifact kinds a mode loads. A workflow worker holds no HTTP route table. */
const ARTIFACTS_BY_MODE: Record<WorkerMode, readonly string[]> = {
	route: ["route", "custom-block", "project-config"],
	workflow: ["workflow", "custom-block", "project-config"],
	both: ["route", "workflow", "custom-block", "project-config"],
};

/** Rejects an unknown mode loudly — a typo must not silently become `both`. */
export function assertWorkerMode(mode: string): WorkerMode {
	if (!(WORKER_MODES as readonly string[]).includes(mode)) {
		throw new Error(
			`WORKER_MODE must be one of ${WORKER_MODES.join(", ")} — got "${mode}"`,
		);
	}
	return mode as WorkerMode;
}

export function jobKindsForMode(mode: string) {
	return KINDS_BY_MODE[assertWorkerMode(mode)];
}

export function artifactKindsForMode(mode: string) {
	return ARTIFACTS_BY_MODE[assertWorkerMode(mode)];
}

export const jobSubject = (projectId: string, kind: string) =>
	`${SUBJECT_ROOT}.${projectId}.${kind}`;

/**
 * What one worker deployment subscribes to: one explicit subject per kind, not
 * the `.>` wildcard it used to be.
 *
 * A work-queue stream requires non-overlapping consumer filters. With the
 * wildcard, a `both` worker and a `workflow` worker on the same project overlap
 * and JetStream refuses the second consumer at boot — which is the behaviour we
 * want, but only if the filters are precise enough to say so. Listing kinds
 * explicitly (multi-filter consumers, 2.10+; we pin 2.14) is what makes "one
 * worker mode per project" an error the operator sees rather than two workers
 * quietly running the same job twice.
 */
export function projectJobFilters(projectId: string, kinds: readonly string[]) {
	const project = projectId === ALL_PROJECTS ? "*" : projectId;
	return kinds.map((kind) => `${SUBJECT_ROOT}.${project}.${kind}`);
}

/**
 * Durable name per deployment and mode, so replicas of the same worker compete
 * for the same messages while different projects never see each other's.
 *
 * Mode is part of the name on purpose: two modes on one project must end up as
 * two consumers with overlapping filters, which the broker rejects. Sharing one
 * durable would instead let the second worker silently rewrite the first's
 * filters. Consumer names allow no dots or wildcards.
 */
export function jobConsumerName(projectId: string, mode: string) {
	return `${jobConsumerPrefix(projectId)}_${assertWorkerMode(mode)}`;
}

/**
 * The name this deployment's consumer had before modes existed, when it took
 * every kind through one `fluxify.jobs.<project>.>` filter.
 *
 * A durable outlives the build that made it, and a work-queue stream allows one
 * consumer per subject — so on an upgrade that leftover overlaps every
 * mode-suffixed consumer and the broker refuses to create them. The queue then
 * accepts runs no worker is subscribed to. The worker deletes this on startup;
 * an install that never had it deletes nothing.
 */
export function legacyJobConsumerName(projectId: string) {
	return jobConsumerPrefix(projectId);
}

function jobConsumerPrefix(projectId: string) {
	const project =
		projectId === ALL_PROJECTS
			? "all"
			: projectId.replace(/[^a-zA-Z0-9_-]/g, "_");
	return `fluxify_jobs_${project}`;
}
