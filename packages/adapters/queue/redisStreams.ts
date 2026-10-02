import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "@fluxify/common";
import type { Redis } from "ioredis";
import { createRedisClient, type RedisVariantConfig } from "../kv/redis";
import {
	type QueueBatch,
	QueueConnection,
	type QueueEvent,
	type QueueHandler,
	QueueSourceGoneError,
	type QueueSubscription,
} from "./base";

/**
 * A Redis stream, read through a consumer group over a KV integration's
 * credentials.
 *
 * Each worker loop holds its own connection, because `XREADGROUP BLOCK` holds
 * the one it runs on. On start the first loop re-reads this consumer's own
 * unacked entries; after that every loop reclaims entries other consumers left
 * idle past `claimIdleMs`, then reads new ones. A batch that is not committed
 * stays pending and is reclaimed the same way, which is how a failure comes back.
 */

/** What a Redis Streams trigger reads. */
export type RedisStreamsSource = {
	stream: string;
	/** this worker's name in the group; empty is the host name */
	consumer?: string;
	/** a group created here reads the whole stream (`0`), not only new entries (`$`) */
	fromBeginning?: boolean;
	/** how long an entry sits unacked before another consumer may claim it */
	claimIdleMs?: number;
	/** where failed entries go; empty is `<stream>:dlq` */
	dlqStream?: string;
};

/** A stream entry as Redis replies with it; fields are null once the entry is deleted. */
type Entry = [id: string, fields: string[] | null];

/** The entry's fields, and who in the group holds it. */
export type RedisStreamEvent = QueueEvent & {
	data: Record<string, string>;
	consumer: string;
	deliveryCount: number;
};

/** How long one read waits for new entries; stop cuts it short. */
const BLOCK_MS = 5_000;
const DEFAULT_CLAIM_IDLE_MS = 60_000;

export class RedisStreamsConnection extends QueueConnection {
	private client?: Redis;
	private readonly readers: Redis[] = [];
	private readonly workers: Promise<void>[] = [];
	private subscription!: QueueSubscription;
	private handler!: QueueHandler;
	private stream = "";
	private group = "";
	private consumer = "";
	private claimIdleMs = DEFAULT_CLAIM_IDLE_MS;
	private dlqStream = "";
	private claimCursor = "0-0";
	private nextClaimAt = 0;
	/** events this connection read, so a commit cannot ack someone else's ids */
	private readonly owned = new WeakSet<QueueEvent>();
	private stopped = false;
	private reportedGone = false;
	private readonly halted = Promise.withResolvers<void>();

	constructor(private readonly config: RedisVariantConfig) {
		super();
	}

	async consume(subscription: QueueSubscription, handler: QueueHandler) {
		const source = subscription.source as Partial<RedisStreamsSource>;
		if (!source.stream) throw new Error("A Redis Streams trigger needs a stream key");
		this.subscription = subscription;
		this.handler = handler;
		this.stream = source.stream;
		this.group = subscription.consumerGroup;
		this.consumer = source.consumer || hostname();
		this.claimIdleMs = source.claimIdleMs ?? DEFAULT_CLAIM_IDLE_MS;
		this.dlqStream = source.dlqStream || `${source.stream}:dlq`;

		this.client = quiet(createRedisClient(this.config));
		try {
			await createGroup(this.client, this.stream, this.group, Boolean(source.fromBeginning));
		} catch (error) {
			this.client.disconnect();
			throw error;
		}
		for (let i = 0; i < subscription.concurrency; i++) {
			const reader = quiet(this.client.duplicate());
			this.readers.push(reader);
			this.workers.push(this.work(reader, i === 0));
		}
	}

	async commit(batch: QueueBatch) {
		if (batch.events.some((event) => !this.owned.has(event)))
			throw new Error("This batch was not read by this connection");
		await this.client!.xack(this.stream, this.group, ...batch.events.map((e) => e.offset));
	}

	async moveToDLQ(batch: QueueBatch, error: unknown) {
		const pipeline = this.client!.pipeline();
		for (const event of batch.events) {
			pipeline.xadd(
				this.dlqStream,
				"*",
				...Object.entries((event.data ?? {}) as Record<string, string>).flat(),
				"x-fluxify-error",
				String(error),
				"x-fluxify-stream",
				event.topic,
				"x-fluxify-id",
				event.offset,
				"x-fluxify-consumer-group",
				batch.consumerGroup,
			);
		}
		const failed = (await pipeline.exec())?.find(([cause]) => cause);
		if (failed)
			throw new Error(`Could not dead-letter to "${this.dlqStream}": ${String(failed[0])}`);
	}

	/** Entries not yet read by the group plus those read and unacked. Null before Redis 7. */
	async lag() {
		if (!this.client) return null;
		const groups = (await this.client.call("XINFO", "GROUPS", this.stream)) as unknown[][];
		for (const flat of groups) {
			const info = pairs(flat);
			if (info.name !== this.group) continue;
			return typeof info.lag === "number" ? info.lag + Number(info.pending) : null;
		}
		return null;
	}

	async stop() {
		this.stopped = true;
		this.halted.resolve();
		// cuts the blocking reads short; in-flight batches still commit on `client`
		for (const reader of this.readers) reader.disconnect();
		await Promise.allSettled(this.workers);
		// what was read and not acked stays pending, for the next start to pick up
		await this.client?.quit().catch(() => this.client?.disconnect());
	}

	raw() {
		return this.client;
	}

	private async work(reader: Redis, ownFirst: boolean) {
		// this consumer's unacked entries from before a restart, oldest first
		let history: string | null = ownFirst ? "0" : null;
		while (!this.stopped) {
			try {
				if (history) {
					const entries = await this.read(reader, history);
					if (entries.length === 0) history = null;
					else {
						history = entries.at(-1)![0];
						await this.deliverAll(entries, true);
					}
					continue;
				}
				const claimed = await this.claim();
				if (claimed.length) await this.deliverAll(claimed, true);
				else await this.deliverAll(await this.readNew(reader), false);
			} catch (error) {
				if (this.stopped) return;
				if (isSourceGone(error)) return this.gone(error);
				logger.warn(
					`[redis] ${this.group} on ${this.stream} read failed: ${String(error)}`,
					"QUEUE.redis",
				);
				await Promise.race([sleep(1_000), this.halted.promise]);
			}
		}
	}

	/**
	 * New entries. Redis answers as soon as one is there, so a part-filled batch
	 * keeps reading until it is full or `maxWaitMs` runs out.
	 */
	private async readNew(reader: Redis) {
		const { batchSize, maxWaitMs } = this.subscription;
		// never longer than the claim sweep's interval, so a short claimIdleMs still reclaims promptly
		const entries = await this.read(
			reader,
			">",
			Math.min(BLOCK_MS, Math.max(this.claimIdleMs / 2, 1_000)),
		);
		// read entries are pending with no heartbeat yet: wait less than half of claimIdleMs
		const deadline = Date.now() + Math.min(maxWaitMs, this.claimIdleMs / 2);
		while (entries.length > 0 && entries.length < batchSize && !this.stopped) {
			const left = Math.ceil(deadline - Date.now());
			if (left <= 0) break;
			entries.push(...(await this.read(reader, ">", left, batchSize - entries.length)));
		}
		return entries;
	}

	/** `>` with `block` reads new entries; an id re-reads this consumer's own pending. */
	private async read(
		reader: Redis,
		from: string,
		block?: number,
		count = this.subscription.batchSize,
	): Promise<Entry[]> {
		// BLOCK 0 would wait forever
		const wait = block ? ["BLOCK", Math.max(1, block)] : [];
		const reply = (await reader.call(
			"XREADGROUP",
			"GROUP",
			this.group,
			this.consumer,
			"COUNT",
			count,
			...wait,
			"STREAMS",
			this.stream,
			from,
		)) as [string, Entry[]][] | null;
		return reply?.[0]?.[1] ?? [];
	}

	/**
	 * Entries a dead consumer left idle. A full sweep of the pending list ends the
	 * cursor at `0-0`; the next waits, so an idle stream is not scanned every read.
	 */
	private async claim(): Promise<Entry[]> {
		if (Date.now() < this.nextClaimAt) return [];
		const [next, entries] = (await this.client!.call(
			"XAUTOCLAIM",
			this.stream,
			this.group,
			this.consumer,
			this.claimIdleMs,
			this.claimCursor,
			"COUNT",
			this.subscription.batchSize,
		)) as [string, Entry[]];
		this.claimCursor = next;
		if (next === "0-0") this.nextClaimAt = Date.now() + Math.max(this.claimIdleMs / 2, 1_000);
		return entries;
	}

	private async deliverAll(entries: Entry[], redelivered: boolean) {
		// trimmed while pending: nothing left to run, so it only leaves the pending list
		const deleted = entries.filter(([, fields]) => !fields).map(([id]) => id);
		if (deleted.length) await this.client!.xack(this.stream, this.group, ...deleted);
		const live = entries.filter(([, fields]) => fields);
		if (live.length === 0) return;
		const counts = redelivered ? await this.deliveryCounts(live) : undefined;
		for (const batch of this.split(live)) await this.deliver(batch, counts);
	}

	/** Redis's own count of how often each entry was handed out, this time included. */
	private async deliveryCounts(entries: Entry[]) {
		// bounded by what this consumer can hold at once, the batch included
		const { batchSize, concurrency } = this.subscription;
		const rows = (await this.client!.call(
			"XPENDING",
			this.stream,
			this.group,
			entries[0]![0],
			entries.at(-1)![0],
			batchSize * (concurrency + 1),
			this.consumer,
		)) as [string, string, number, number][];
		return new Map(rows.map(([id, , , count]) => [id, count]));
	}

	/** Cuts a read before it goes over `maxBytes` — but never into an empty batch. */
	private split(entries: Entry[]) {
		const batches: Entry[][] = [];
		let bytes = 0;
		for (const entry of entries) {
			const size = entry[1]!.reduce((sum, part) => sum + Buffer.byteLength(part), 0);
			const last = batches.at(-1);
			if (!last || bytes + size > this.subscription.maxBytes) {
				batches.push([entry]);
				bytes = size;
			} else {
				last.push(entry);
				bytes += size;
			}
		}
		return batches;
	}

	private async deliver(entries: Entry[], counts?: Map<string, number>) {
		if (this.stopped) return;
		const events = entries.map((entry) => this.toEvent(entry, counts?.get(entry[0]) ?? 1));
		const batch: QueueBatch = {
			events,
			consumerGroup: this.group,
			highWatermark: null,
			// the most-delivered entry decides, so a poison entry reaches the dead-letter stream
			attempt: Math.max(...events.map((event) => event.deliveryCount)),
		};
		// a long run must not go idle past claimIdleMs, or another consumer takes the batch;
		// JUSTID resets the idle time without counting a delivery
		const ids = entries.map(([id]) => id);
		const heartbeat = setInterval(
			() =>
				void this.client!.call(
					"XCLAIM",
					this.stream,
					this.group,
					this.consumer,
					0,
					...ids,
					"JUSTID",
				).catch(() => undefined),
			Math.max(this.claimIdleMs / 3, 100),
		);
		try {
			await this.handler(batch, this);
		} catch (error) {
			if (!this.stopped)
				logger.warn(
					`[redis] ${this.group} left ${this.stream}@${ids[0]} pending, reclaimed after ${this.claimIdleMs}ms: ${String(error)}`,
					"QUEUE.redis",
				);
		} finally {
			clearInterval(heartbeat);
		}
	}

	private toEvent([id, fields]: Entry, deliveryCount: number): RedisStreamEvent {
		const data: Record<string, string> = {};
		for (let i = 0; i < fields!.length; i += 2) data[fields![i]!] = fields![i + 1]!;
		const event: RedisStreamEvent = {
			data,
			topic: this.stream,
			partition: 0,
			offset: id,
			key: null,
			headers: {},
			// an entry id starts with its insert time in ms
			timestamp: new Date(Number(id.split("-")[0])).toISOString(),
			consumer: this.consumer,
			deliveryCount,
		};
		this.owned.add(event);
		return event;
	}

	/** Deleted under us: every loop stops, and the owner hears it once. */
	private gone(error: unknown) {
		if (this.reportedGone) return;
		this.reportedGone = true;
		this.stopped = true;
		this.halted.resolve();
		for (const reader of this.readers) reader.disconnect();
		logger.error(`[redis] ${this.group} stream ${this.stream} is gone, stopping`, "QUEUE.redis");
		this.subscription.onSourceGone?.(
			new QueueSourceGoneError(
				`Redis no longer has the stream this trigger reads: stream "${this.stream}", group "${this.group}" (${error instanceof Error ? error.message : String(error)}). Enable the trigger again to recreate it.`,
			),
		);
	}
}

/** The stream or its group was deleted while consuming; reading again cannot help. */
export function isSourceGone(error: unknown) {
	return error instanceof Error && /NOGROUP/.test(error.message);
}

/** Joins the group, creating it and the stream when missing; an existing group keeps its position. */
async function createGroup(client: Redis, stream: string, group: string, fromBeginning: boolean) {
	try {
		await client.xgroup("CREATE", stream, group, fromBeginning ? "0" : "$", "MKSTREAM");
	} catch (error) {
		if (!String(error).includes("BUSYGROUP")) throw error;
	}
}

/** Redis's flat `[name, value, ...]` replies as an object. */
function pairs(flat: unknown[]) {
	const out: Record<string, unknown> = {};
	for (let i = 0; i < flat.length; i += 2) out[String(flat[i])] = flat[i + 1];
	return out;
}

/** Failures surface on the commands; ioredis would otherwise print each reconnect error. */
function quiet(client: Redis) {
	client.on("error", () => undefined);
	return client;
}

export function createConnection(config: unknown) {
	return new RedisStreamsConnection(config as RedisVariantConfig);
}

export { createProducer } from "./redisStreamsProducer";

/**
 * Checks before a trigger is saved: the server answers, and the key is a stream
 * or not there yet. The stream and group are created when the trigger starts.
 */
export async function assertRedisStream(config: RedisVariantConfig, stream: string) {
	const client = quiet(
		createRedisClient(config, { maxRetriesPerRequest: 0, retryStrategy: () => null }),
	);
	try {
		const type = await client.type(stream);
		if (type !== "stream" && type !== "none")
			throw new Error(`Key "${stream}" holds a ${type}, not a stream`);
	} catch (error) {
		throw new Error(
			`Could not check stream "${stream}" on Redis: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		client.disconnect();
	}
}
