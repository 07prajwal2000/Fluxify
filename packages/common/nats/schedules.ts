import { jetstream, jetstreamManager } from "@nats-io/jetstream";
import type { NatsConnection } from "@nats-io/nats-core";
import { logger } from "../logging";
import { type Codec, jsonCodec } from "./codec";
import type { Millis } from "./types";

/**
 * Server-side schedules (ADR-51, NATS 2.14+).
 *
 * A schedule is not an object with an API — it is a **message** carrying
 * `Nats-Schedule` headers, sitting on a stream. The server reads it, and at
 * each due instant copies its body onto the target subject. That has three
 * consequences the rest of the codebase has to live with:
 *
 * 1. The stream cannot be work-queue. An ack removes a message, and the message
 *    *is* the schedule, so a consumer reading the schedule subject would delete
 *    the schedule it was meant to honour.
 * 2. The target subject must be captured by the same stream, so the fire lands
 *    beside the schedule rather than wherever the work is finally done. The hop
 *    from there to the job queue is structural, not a preference.
 * 3. One subject holds one schedule. Publishing again replaces it, which is why
 *    each trigger gets its own subject and why an update is just a republish.
 *
 * Cancelling is a purge of that subject. There is a header-based cancel too
 * (`Nats-Scheduler` + `Nats-Schedule-Next: purge`), but it requires publishing
 * onto *another* subject to carry the instruction, and a purge says the same
 * thing without leaving a message behind.
 */

export interface ScheduleSpecInput {
	/** The `Nats-Schedule` value: `@at <rfc3339>`, `@every 5m`, `@daily`, or six-field cron. */
	specification: string;
	/** Where each fire is delivered. Must be captured by the same stream. */
	target: string;
	/** IANA name. Cron and predefined aliases only; ignored by `@at` and `@every`. */
	timezone?: string;
	/**
	 * How long a generated fire survives unconsumed. Without one, a server that
	 * was down over a weekend delivers every missed fire at once the moment it
	 * comes back.
	 */
	ttlSeconds?: number;
}

export interface PublishScheduleOptions<T> {
	msgId?: string;
	codec?: Codec<T>;
}

/**
 * Writes (or replaces) the schedule on `subject`, with `data` as the body every
 * fire will carry.
 *
 * The body is copied verbatim to the target, so whatever the consumer of the
 * fire needs to do its job has to be in here — it has no other source.
 */
export async function publishSchedule<T>(
	nc: NatsConnection,
	subject: string,
	data: T,
	spec: ScheduleSpecInput,
	options: PublishScheduleOptions<T> = {},
): Promise<{ seq: number }> {
	const codec = options.codec ?? jsonCodec<T>();
	const ack = await jetstream(nc).publish(subject, codec.encode(data), {
		...(options.msgId ? { msgID: options.msgId } : {}),
		schedule: {
			specification: spec.specification,
			target: spec.target,
			...(spec.timezone ? { timezone: spec.timezone } : {}),
			...(spec.ttlSeconds ? { ttl: `${spec.ttlSeconds}s` } : {}),
		},
	});
	logger.debug(
		`[nats] scheduled ${subject} -> ${spec.target} (${spec.specification})`,
		"NATS",
	);
	return { seq: ack.seq };
}

/**
 * Removes the schedule on a subject. Idempotent: purging a subject that holds
 * no schedule is a no-op, which is what makes it safe for both "pause this
 * trigger" and "this trigger no longer exists".
 */
export async function purgeSchedule(
	nc: NatsConnection,
	stream: string,
	subject: string,
): Promise<number> {
	const jsm = await jetstreamManager(nc);
	const result = await jsm.streams.purge(stream, { filter: subject });
	if (result.purged) logger.debug(`[nats] purged schedule ${subject}`, "NATS");
	return result.purged ?? 0;
}

/**
 * The subjects currently holding a schedule, under a wildcard.
 *
 * This is how the reconciler finds orphans: anything on the stream that the
 * database no longer knows about. Without it, a trigger deleted while the
 * server was down keeps firing forever with nothing to stop it.
 */
export async function scheduleSubjects(
	nc: NatsConnection,
	stream: string,
	filter: string,
): Promise<string[]> {
	const jsm = await jetstreamManager(nc);
	const info = await jsm.streams.info(stream, { subjects_filter: filter });
	return Object.keys(info.state.subjects ?? {});
}

/**
 * How long a fire should live: half the gap to the next one, capped at five
 * minutes.
 *
 * Half an interval, because a fire still pending when the next one is due is a
 * backlog forming rather than a run that is merely late. The cap keeps a daily
 * schedule from holding a twelve-hour-old fire that nobody wants run.
 *
 * One-shots get no TTL — `@at` fires once, and expiring it would turn "run this
 * at midnight" into "run this at midnight unless the worker was busy".
 */
export function fireTtlSeconds(intervalMs: Millis | undefined): number | undefined {
	if (!intervalMs) return undefined;
	return Math.max(1, Math.min(Math.floor(intervalMs / 2000), 300));
}
