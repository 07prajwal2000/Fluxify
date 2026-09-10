import { logger } from "@fluxify/common";
import {
	ensureStream,
	fireTtlSeconds,
	publishSchedule,
	purgeSchedule,
	scheduleSubjects,
} from "@fluxify/common/nats";
import { applyJitter, assertSchedule, intervalMs } from "@fluxify/common/schedule";
import { natsConnection } from "../../db/nats";
import {
	ALL_PROJECTS,
	SCHEDULES_STREAM,
	SCHEDULES_SUBJECTS,
	fireSubject,
	projectScheduleFilter,
	scheduleSubject,
	triggerIdFromSubject,
} from "./subjects";
import type { ScheduledTrigger, ScheduleFireBody } from "./types";

/**
 * Keeping NATS' live schedules in step with the trigger table.
 *
 * Postgres is authoritative and NATS is the thing that actually fires, so the
 * two can disagree in both directions: a restored backup knows about triggers
 * NATS lost, and a wiped-and-recreated NATS volume forgets schedules nobody
 * will ever republish. Either way the failure is silent — a trigger that simply
 * never runs, or one that keeps running after it was deleted. Converging on
 * boot is the only thing that catches those.
 *
 * Every write path goes through here rather than through the NATS client
 * directly, so jitter and TTL are applied in exactly one place.
 */

/**
 * Provisions the stream. Idempotent, and called from both the API server and
 * any worker that consumes fires — whichever gets there first creates it.
 *
 * `limits` retention is not a tuning choice: a schedule is a message, and on a
 * work-queue stream the first consumer to ack would delete it. No `maxAge`
 * either, for the same reason — a `@daily` schedule that aged out of its own
 * stream would stop firing a week in with nothing to show why.
 */
export async function ensureSchedulesStream() {
	await ensureStream(natsConnection(), {
		name: SCHEDULES_STREAM,
		subjects: [SCHEDULES_SUBJECTS],
		retention: "limits",
		discard: "old",
		allowMsgSchedules: true,
		allowMsgTtl: true,
	});
}

/**
 * Writes the schedule for one trigger, replacing whatever was on its subject.
 *
 * Jitter and TTL are applied here, deliberately, and are not user-facing
 * settings. Both exist to protect the instance from the shape of the schedules
 * on it, which is not something the person writing one trigger can see.
 */
export async function upsertSchedule(trigger: ScheduledTrigger) {
	// A schedule linked to nothing would fire into an empty loop forever. The
	// row stays active; there is simply nothing to publish until a workflow is
	// attached, and attaching one republishes.
	if (!trigger.workflowId) return removeSchedule(trigger.projectId, trigger.id);
	const parsed = assertSchedule(trigger.schedule, trigger.timezone);
	await ensureSchedulesStream();

	const specification = applyJitter(trigger.schedule, trigger.id);
	const body: ScheduleFireBody = {
		triggerId: trigger.id,
		projectId: trigger.projectId,
		workflowId: trigger.workflowId,
		payload: trigger.payload ?? null,
	};

	await publishSchedule(
		natsConnection(),
		scheduleSubject(trigger.projectId, trigger.id),
		body,
		{
			specification,
			target: fireSubject(trigger.projectId, trigger.id),
			// Cron only, and not merely because it would be ignored elsewhere: the
			// server REJECTS a timezone sent with `@every` or `@at` outright
			// ("message schedules pattern is invalid"). An interval has no wall
			// clock to be shifted by, and `@at` carries its own.
			...(parsed.kind === "cron" ? { timezone: trigger.timezone } : {}),
			ttlSeconds: fireTtlSeconds(intervalMs(trigger.schedule, trigger.timezone)),
		},
	);
	logger.info(
		`[schedules] ${trigger.id} scheduled ${specification} (${trigger.timezone})`,
		"SCHEDULES",
	);
}

/**
 * Stops a trigger firing. Pause and delete are the same operation here — the
 * row's `active` flag is what tells them apart, and NATS does not need to know
 * the difference.
 */
export async function removeSchedule(projectId: string, triggerId: string) {
	await purgeSchedule(
		natsConnection(),
		SCHEDULES_STREAM,
		scheduleSubject(projectId, triggerId),
	);
}

/**
 * Brings NATS in line with the database, in both directions.
 *
 * Called at boot with every active scheduled trigger. Republishing an unchanged
 * schedule is safe — the spec is deterministic in the trigger id, so a boot
 * that changes nothing writes the same schedule back rather than shifting every
 * trigger's fire time.
 */
export async function reconcileSchedules(triggers: ScheduledTrigger[]) {
	await ensureSchedulesStream();

	const wanted = new Set<string>();
	for (const trigger of triggers) {
		wanted.add(scheduleSubject(trigger.projectId, trigger.id));
		try {
			await upsertSchedule(trigger);
		} catch (error) {
			// One bad row must not stop the rest converging — and a schedule the
			// server rejects is exactly the kind of thing that would otherwise be
			// discovered at 3am.
			logger.error(
				`[schedules] failed to schedule ${trigger.id}: ${String(error)}`,
				"SCHEDULES",
			);
		}
	}

	const live = await scheduleSubjects(
		natsConnection(),
		SCHEDULES_STREAM,
		projectScheduleFilter(ALL_PROJECTS),
	);
	let orphans = 0;
	for (const subject of live) {
		if (wanted.has(subject)) continue;
		await purgeSchedule(natsConnection(), SCHEDULES_STREAM, subject);
		orphans++;
		logger.warn(
			`[schedules] purged orphan schedule for trigger ${triggerIdFromSubject(subject) ?? subject}`,
			"SCHEDULES",
		);
	}

	logger.info(
		`[schedules] reconciled ${triggers.length} schedule(s), purged ${orphans} orphan(s)`,
		"SCHEDULES",
	);
}
