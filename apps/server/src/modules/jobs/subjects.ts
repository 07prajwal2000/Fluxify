/**
 * Naming for the job queue.
 *
 * ONE stream carries every kind of background work — queued custom blocks
 * today, crons/workflows/scheduled jobs later. A stream per feature would mean
 * a pile of mostly-idle streams and consumers to operate, so kinds are a subject
 * token instead: adding one costs a handler registration and nothing else.
 *
 * Subjects are `fluxify.jobs.<projectId>.<kind>`, and every consumer names both
 * tokens exactly. A work-queue stream requires the live consumers to partition
 * the subject space, and a wildcard cannot: `fluxify.jobs.*.workflow` overlaps
 * `fluxify.jobs.<project>.workflow`, so a catch-all worker holding the wildcard
 * locks out every project that claims a node of its own.
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
	workflow: ["workflow", "custom-block", "project-config", "trigger"],
	both: ["route", "workflow", "custom-block", "project-config", "trigger"],
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
 * What one consumer subscribes to: exactly one project and one kind.
 *
 * Never a wildcard. `FLUXIFY_JOBS` is work-queue, so the live consumers must
 * partition the subject space — and `fluxify.jobs.*.workflow` overlaps
 * `fluxify.jobs.<project>.workflow`, which JetStream refuses outright
 * ("filtered consumer not unique on workqueue stream"). A catch-all worker
 * therefore holds one consumer per project it has artifacts for, rather than
 * one consumer for every project at once.
 */
export function jobFilter(projectId: string, kind: string) {
	assertConcrete(projectId);
	return jobSubject(projectId, kind);
}

/**
 * Durable name per project and kind — deliberately *not* per worker mode.
 *
 * Mode does not partition anything: every mode consumes `custom-block`, so a
 * catch-all `both` worker and a project's own `workflow` worker always overlap
 * and the second one is refused at boot. Project and kind are the only tokens
 * the subject has, so one consumer per pair is the one naming that cannot
 * collide.
 *
 * Sharing the durable across workers is also what a work queue wants: every
 * worker serving a project pulls from the same consumer and the jobs are split
 * between them, instead of one of them being locked out. It is what makes
 * replicas of a claim compete for work, and it means a node that drains leaves
 * behind nothing another worker can trip over.
 */
export function jobConsumerName(projectId: string, kind: string) {
	assertConcrete(projectId);
	return `fluxify_jobs_${sanitize(projectId)}_${sanitize(kind)}`;
}

/**
 * A consumer is per project, so `*` reaching one of the two functions above is
 * a caller that forgot to resolve its project set — a mistake worth a crash at
 * boot rather than a wildcard consumer that locks every other worker out.
 */
function assertConcrete(projectId: string) {
	if (projectId === ALL_PROJECTS)
		throw new Error(
			"a job consumer serves one project — a catch-all worker serves each project it discovers",
		);
}

/** Consumer names allow no dots or wildcards. */
const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
