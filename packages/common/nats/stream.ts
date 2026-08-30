import {
	AckPolicy,
	DiscardPolicy,
	RetentionPolicy,
	StorageType,
	jetstreamManager,
	type ConsumerConfig,
	type ConsumerUpdateConfig,
	type StreamConfig,
	type StreamUpdateConfig,
} from "@nats-io/jetstream";
import { nanos, type NatsConnection } from "@nats-io/nats-core";
import { logger } from "../logging";
import { isConsumerNotFound, isStreamNotFound } from "./errors";
import type { ConsumerSpec, StreamSpec } from "./types";

/**
 * Stream and consumer provisioning, in one place. Every worker in the codebase
 * used to carry its own `ensureStream` / `ensureConsumer` pair, all subtly
 * different and all typed `jsm: any` — so a wrong field name was a runtime
 * surprise rather than a compile error. These are the typed versions.
 *
 * Both are idempotent: safe to call from every process that touches the stream,
 * on every boot.
 */

const RETENTION: Record<NonNullable<StreamSpec["retention"]>, RetentionPolicy> = {
	workqueue: RetentionPolicy.Workqueue,
	limits: RetentionPolicy.Limits,
	interest: RetentionPolicy.Interest,
};

const DISCARD: Record<NonNullable<StreamSpec["discard"]>, DiscardPolicy> = {
	old: DiscardPolicy.Old,
	new: DiscardPolicy.New,
};

const STORAGE: Record<NonNullable<StreamSpec["storage"]>, StorageType> = {
	file: StorageType.File,
	memory: StorageType.Memory,
};

/**
 * The fields NATS will accept on an existing stream. Retention and storage are
 * fixed at creation, so sending them on an update is at best noise and at worst
 * a rejection — they are deliberately absent here.
 */
export function updatableStreamConfig(
	spec: StreamSpec,
): Partial<StreamUpdateConfig> {
	const config: Partial<StreamUpdateConfig> = { subjects: spec.subjects };
	if (spec.maxAgeMs !== undefined) config.max_age = nanos(spec.maxAgeMs);
	if (spec.maxBytes !== undefined) config.max_bytes = spec.maxBytes;
	if (spec.discard !== undefined) config.discard = DISCARD[spec.discard];
	if (spec.duplicateWindowMs !== undefined) {
		config.duplicate_window = nanos(spec.duplicateWindowMs);
	}
	if (spec.allowMsgTtl !== undefined) config.allow_msg_ttl = spec.allowMsgTtl;
	if (spec.allowMsgSchedules !== undefined) {
		config.allow_msg_schedules = spec.allowMsgSchedules;
	}
	return config;
}

export function newStreamConfig(
	spec: StreamSpec,
): Partial<StreamConfig> & { name: string } {
	return {
		...updatableStreamConfig(spec),
		name: spec.name,
		retention: RETENTION[spec.retention ?? "limits"],
		...(spec.storage ? { storage: STORAGE[spec.storage] } : {}),
	};
}

/**
 * What a live consumer will accept without being torn down and recreated.
 *
 * Filters are in here on purpose. A durable outlives the code that made it, so
 * adding a job kind to a mode has to reach the consumer that already exists —
 * otherwise the new kind is published to a stream nobody is filtered for and
 * the jobs sit there looking enqueued. Filter subjects are updatable from 2.10;
 * we pin 2.14.
 */
export function updatableConsumerConfig(
	spec: ConsumerSpec,
): Partial<ConsumerUpdateConfig> {
	const filters = spec.filterSubjects ?? [];
	return {
		ack_wait: nanos(spec.ackWaitMs ?? 60_000),
		max_deliver: spec.maxDeliver ?? 1,
		...(spec.maxAckPending !== undefined
			? { max_ack_pending: spec.maxAckPending }
			: {}),
		// A single filter goes in the singular field: the two are mutually
		// exclusive, and a server rejects a config carrying both.
		...(filters.length === 1
			? { filter_subject: filters[0] }
			: filters.length > 1
				? { filter_subjects: filters }
				: {}),
	};
}

export function newConsumerConfig(spec: ConsumerSpec): Partial<ConsumerConfig> {
	return {
		...updatableConsumerConfig(spec),
		durable_name: spec.durable,
		ack_policy: AckPolicy.Explicit,
	};
}

/**
 * Creates the stream, or brings an existing one's limits in line with the spec.
 *
 * Reads before writing rather than add-and-swallow: a `catch {}` around `add`
 * cannot tell "already exists" from a permissions failure or JetStream being
 * disabled, and both of those should stop a boot loudly.
 */
export async function ensureStream(
	nc: NatsConnection,
	spec: StreamSpec,
): Promise<void> {
	const jsm = await jetstreamManager(nc);
	try {
		await jsm.streams.info(spec.name);
		await jsm.streams.update(spec.name, updatableStreamConfig(spec));
	} catch (error) {
		if (!isStreamNotFound(error)) throw error;
		await jsm.streams.add(newStreamConfig(spec));
		logger.info(`[nats] stream ${spec.name} created`, "NATS");
	}
}

/**
 * Creates the durable consumer, or updates its limits in place. Updating
 * matters: recreating would drop whatever is pending, so tuning `ack_wait`
 * would cost the queue its in-flight work.
 */
export async function ensureConsumer(
	nc: NatsConnection,
	stream: string,
	spec: ConsumerSpec,
): Promise<void> {
	const jsm = await jetstreamManager(nc);
	try {
		await jsm.consumers.info(stream, spec.durable);
		await jsm.consumers.update(stream, spec.durable, updatableConsumerConfig(spec));
		return;
	} catch (error) {
		if (!isConsumerNotFound(error)) throw error;
	}
	try {
		await jsm.consumers.add(stream, newConsumerConfig(spec));
		logger.info(`[nats] consumer ${stream}/${spec.durable} created`, "NATS");
	} catch (error) {
		throw (await describeConsumerConflict(jsm, stream, spec, error)) ?? error;
	}
}

/**
 * A work-queue stream allows one consumer per subject, so a durable left behind
 * by an older build — a renamed one, a wider filter — makes every new consumer
 * unaddable. The broker says only "not unique", which leaves an operator
 * guessing; this names the durable in the way and what it is holding.
 */
async function describeConsumerConflict(
	jsm: Awaited<ReturnType<typeof jetstreamManager>>,
	stream: string,
	spec: ConsumerSpec,
	error: unknown,
) {
	if (!/not unique/i.test(String(error))) return undefined;
	const existing: string[] = [];
	for await (const consumer of await jsm.consumers.list(stream).next()) {
		if (consumer.name === spec.durable) continue;
		const filters = consumer.config.filter_subjects ?? [
			consumer.config.filter_subject ?? ">",
		];
		existing.push(`${consumer.name} (${filters.join(", ")})`);
	}
	return new Error(
		`consumer ${stream}/${spec.durable} overlaps an existing consumer on a work-queue stream. ` +
			`Wanted ${(spec.filterSubjects ?? [">"]).join(", ")}; already there: ${existing.join("; ") || "none"}. ` +
			"Delete the stale consumer, or narrow its filter, then restart.",
	);
}

/**
 * Removes a durable, treating "it was never there" as success.
 *
 * For retiring a consumer a newer build replaced. On a work-queue stream that
 * is not housekeeping: one consumer is allowed per subject, so a durable an old
 * build left behind blocks its successor from ever being created, and the queue
 * fills with work nothing is subscribed to.
 */
export async function deleteConsumer(
	nc: NatsConnection,
	stream: string,
	durable: string,
): Promise<boolean> {
	const jsm = await jetstreamManager(nc);
	try {
		await jsm.consumers.delete(stream, durable);
		logger.info(`[nats] consumer ${stream}/${durable} deleted`, "NATS");
		return true;
	} catch (error) {
		if (isConsumerNotFound(error) || isStreamNotFound(error)) return false;
		throw error;
	}
}

/** Both halves at once — what a worker startup actually wants. */
export async function ensureStreamConsumer(
	nc: NatsConnection,
	stream: StreamSpec,
	consumer: ConsumerSpec,
): Promise<void> {
	await ensureStream(nc, stream);
	await ensureConsumer(nc, stream.name, consumer);
}
