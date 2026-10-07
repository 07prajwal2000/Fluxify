import { logger } from "@fluxify/common";
import {
	consumeQueue,
	ensureConsumer,
	fireTtlSeconds,
	publishSchedule,
	type QueueConsumer,
} from "@fluxify/common/nats";
import { natsConnection } from "../../db/nats";
import { ensureSchedulesStream } from "./reconciler";
import {
	SCHEDULES_STREAM,
	systemFireSubject,
	systemJobConsumerName,
	systemScheduleSubject,
} from "./subjects";

/**
 * The platform's own cron (#619): an hourly and a daily tick for internal jobs
 * like retention. Admin only — the jobs own Postgres tables, and workers never
 * open Postgres.
 *
 * The broker keeps time and fires each tick once. Every job has its own durable
 * consumer, shared by all admin replicas, so each tick runs each job once no
 * matter how many admins are up, with no lock or leader election.
 *
 * Handlers MUST be idempotent and catch up on their own. A fire lives five
 * minutes (`fireTtlSeconds`), so a tick missed while admin was down is dropped,
 * not replayed. Write "delete where older than 30 days", never "delete
 * yesterday", and work in batches so one tick never holds a long lock.
 */

export type SystemTick = "hourly" | "daily";

const TICKS: Record<SystemTick, { specification: string; intervalMs: number }> = {
	hourly: { specification: "@hourly", intervalMs: 60 * 60_000 },
	daily: { specification: "@daily", intervalMs: 24 * 60 * 60_000 },
};

/** Writes both tick schedules. Republishing replaces, so every boot can call it. */
export async function publishSystemTicks() {
	await ensureSchedulesStream();
	for (const [tick, { specification, intervalMs }] of Object.entries(TICKS)) {
		await publishSchedule(
			natsConnection(),
			systemScheduleSubject(tick),
			{ tick },
			{
				specification,
				target: systemFireSubject(tick),
				ttlSeconds: fireTtlSeconds(intervalMs),
			},
		);
	}
	logger.info("[schedules] system ticks scheduled (hourly, daily)", "SCHEDULES");
}

const MAX_DELIVER = 3;

/**
 * Runs `handler` on every `tick`. `job` names the durable consumer, so keep it
 * stable: renaming it starts a new consumer and leaves the old one behind.
 * Acks on success; a throw is retried a minute later, `MAX_DELIVER` times in all.
 */
export async function onSystemTick(
	tick: SystemTick,
	job: string,
	handler: () => Promise<void>,
): Promise<QueueConsumer> {
	const nc = natsConnection();
	await ensureSchedulesStream();
	const durable = systemJobConsumerName(job);
	await ensureConsumer(nc, SCHEDULES_STREAM, {
		durable,
		filterSubjects: [systemFireSubject(tick)],
		// A batched cleanup can take a while. Past this the tick is redelivered,
		// which an idempotent handler shrugs off.
		ackWaitMs: 10 * 60_000,
		maxDeliver: MAX_DELIVER,
		maxAckPending: 1,
	});
	return consumeQueue(
		nc,
		SCHEDULES_STREAM,
		durable,
		async () => {
			await handler();
			logger.info(`[schedules] system job ${job} ran (${tick})`, "SCHEDULES");
		},
		{ maxAttempts: MAX_DELIVER, retryDelayMs: 60_000 },
	);
}
