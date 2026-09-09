/**
 * Naming for scheduled triggers.
 *
 * A third stream, and not by preference. `FLUXIFY_TRIGGERS` is work-queue, so
 * an ack removes the message — and a schedule *is* a message, so a consumer
 * there would delete the schedule it read. `FLUXIFY_JOBS` is work-queue for the
 * same reason. Schedules need a `limits` stream, and the fire subject has to be
 * captured by that same stream, so both live here.
 *
 * Subjects are `fluxify.schedules.<sched|fire>.<projectId>.<triggerId>`. The
 * kind comes before the project so a worker can watch every project's fires
 * with one wildcard while the reconciler's schedules stay out of its filter —
 * the reverse order would need two wildcards to say the same thing.
 *
 * `schedules` rather than the `trigger` of the original issue text: one letter
 * from the existing `fluxify.triggers.>` is not a distinction anyone should
 * have to spot in a subject dump at 3am.
 */

export const SCHEDULES_STREAM = "FLUXIFY_SCHEDULES";

const SUBJECT_ROOT = "fluxify.schedules";

/** Everything the stream captures: the schedules and the fires they produce. */
export const SCHEDULES_SUBJECTS = `${SUBJECT_ROOT}.>`;

/** Serves every project — the catch-all worker deployment. */
export const ALL_PROJECTS = "*";

/** Where a trigger's schedule lives. One subject, one schedule, republish to replace. */
export const scheduleSubject = (projectId: string, triggerId: string) =>
	`${SUBJECT_ROOT}.sched.${projectId}.${triggerId}`;

/** Where the server delivers each fire. */
export const fireSubject = (projectId: string, triggerId: string) =>
	`${SUBJECT_ROOT}.fire.${projectId}.${triggerId}`;

/** Every schedule belonging to a project, for the reconciler's orphan sweep. */
export const projectScheduleFilter = (projectId: string) =>
	`${SUBJECT_ROOT}.sched.${projectId === ALL_PROJECTS ? "*" : projectId}.*`;

/** What a worker pulls fires from. */
export const projectFireFilter = (projectId: string) =>
	`${SUBJECT_ROOT}.fire.${projectId === ALL_PROJECTS ? "*" : projectId}.*`;

/** Reads the trigger id back out of a schedule or fire subject. */
export function triggerIdFromSubject(subject: string): string | undefined {
	const parts = subject.split(".");
	return parts.length === 5 ? parts[4] : undefined;
}

/**
 * Durable name per deployment. Replicas share one, which is what makes them
 * compete for fires instead of each enqueueing the same job.
 *
 * A project worker and a catch-all worker DO overlap here, and that is allowed:
 * this is a `limits` stream, so the broker permits it, and both would enqueue
 * the same job id — which the jobs stream's dedupe window collapses into one
 * run. Consumer names allow no dots or wildcards.
 */
export const fireConsumerName = (projectId: string) =>
	`fluxify_schedule_fires_${
		projectId === ALL_PROJECTS ? "all" : projectId.replace(/[^a-zA-Z0-9_-]/g, "_")
	}`;
