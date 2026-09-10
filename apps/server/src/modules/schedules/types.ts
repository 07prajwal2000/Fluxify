/**
 * What the reconciler needs from a trigger row to schedule it. Deliberately not
 * the row itself: the batch settings mean nothing to a schedule, since a cron
 * is a single event and has no stream to accumulate from.
 */
export type ScheduledTrigger = {
	id: string;
	projectId: string;
	/** The workflow the fire starts. Null means the schedule is not published. */
	workflowId: string | null;
	/** The `Nats-Schedule` spec, as the user wrote it. Jitter is applied later. */
	schedule: string;
	/** IANA name. `UTC` unless the user chose otherwise. */
	timezone: string;
	/** Static data handed to the workflow on every fire. */
	payload?: unknown;
};

/**
 * The schedule's body, copied verbatim onto every fire the server generates.
 *
 * This is the whole reason the fire consumer needs no database: everything it
 * has to know to enqueue the jobs was written here when the schedule was
 * published. The cost is that changing the workflow means republishing the
 * schedule, which the reconciler does on every write anyway.
 */
export type ScheduleFireBody = {
	triggerId: string;
	projectId: string;
	workflowId: string;
	payload?: unknown;
};

export function isScheduleFireBody(value: unknown): value is ScheduleFireBody {
	const body = value as ScheduleFireBody | undefined;
	return (
		!!body &&
		typeof body.triggerId === "string" &&
		typeof body.projectId === "string" &&
		typeof body.workflowId === "string"
	);
}
