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

/** Job kinds this build knows. `custom-block` lives in @fluxify/blocks. */
export const WORKFLOW_JOB = "workflow";

export const jobSubject = (projectId: string, kind: string) =>
	`${SUBJECT_ROOT}.${projectId}.${kind}`;

/** What one worker deployment subscribes to. */
export function projectJobFilter(projectId: string) {
	return projectId === ALL_PROJECTS
		? JOBS_SUBJECTS
		: `${SUBJECT_ROOT}.${projectId}.>`;
}

/**
 * Durable name per deployment, so replicas of the same worker compete for the
 * same messages while different projects never see each other's.
 * Consumer names allow no dots or wildcards.
 */
export function jobConsumerName(projectId: string) {
	return projectId === ALL_PROJECTS
		? "fluxify_jobs_all"
		: `fluxify_jobs_${projectId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}
