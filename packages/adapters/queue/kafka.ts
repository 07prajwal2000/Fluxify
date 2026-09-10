import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "@fluxify/common";
import {
	Admin,
	Consumer,
	MessagesStreamFallbackModes,
	MessagesStreamModes,
	Producer,
	type Message,
	type MessagesStream,
} from "@platformatic/kafka";
import {
	QueueConnection,
	type QueueBatch,
	type QueueEvent,
	type QueueHandler,
	type QueueSubscription,
} from "./base";

/**
 * Kafka, through @platformatic/kafka — pure JS, so it runs under Bun where the
 * librdkafka-based clients do not load.
 *
 * The client hands over one message at a time; batching is done here, per
 * partition, so a batch always commits as one offset and a partition's events
 * are never run out of order. `concurrency` is how many partitions run at once.
 */

/** A Kafka integration's config, `cfg:` references already expanded. */
export type KafkaConfig = {
	/** comma-separated `host:port` list */
	brokers: string;
	clientId?: string;
	ssl?: boolean;
	saslMechanism?: "none" | "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512";
	username?: string;
	password?: string;
	/** where a batch that keeps failing is parked; unset holds the partition instead */
	dlqTopic?: string;
};

/** What a Kafka trigger reads. */
export type KafkaSource = { topics: string[]; fromBeginning?: boolean };

type Lane = {
	pending: Message[];
	bytes: number;
	/** highest offset taken in; a refetch after a rebalance repeats older ones */
	seen: bigint;
	busy: boolean;
	revoked: boolean;
	timer?: ReturnType<typeof setTimeout>;
};

const MAX_REDELIVERY_DELAY_MS = 30_000;

export function clientOptions(config: KafkaConfig) {
	const mechanism = config.saslMechanism;
	return {
		clientId: config.clientId || "fluxify",
		bootstrapBrokers: config.brokers
			.split(",")
			.map((broker) => broker.trim())
			.filter(Boolean),
		...(config.ssl ? { tls: {} } : {}),
		...(mechanism && mechanism !== "none"
			? { sasl: { mechanism, username: config.username, password: config.password } }
			: {}),
	};
}

export class KafkaConnection extends QueueConnection {
	private consumer?: Consumer;
	private stream?: MessagesStream<Buffer, Buffer, Buffer, Buffer>;
	private producer?: Producer;
	private subscription!: QueueSubscription;
	private handler!: QueueHandler;
	private topics: string[] = [];
	private readonly lanes = new Map<string, Lane>();
	/** lanes with a batch ready and no free slot */
	private readonly waiting: Lane[] = [];
	private readonly running = new Set<Promise<void>>();
	/** the broker message behind each event, for commit and dead-lettering */
	private readonly sources = new WeakMap<QueueEvent, Message>();
	private inFlight = 0;
	private buffered = 0;
	private stopped = false;
	private readonly halted = Promise.withResolvers<void>();

	constructor(private readonly config: KafkaConfig) {
		super();
	}

	async consume(subscription: QueueSubscription, handler: QueueHandler) {
		const source = subscription.source as Partial<KafkaSource>;
		this.topics = (source.topics ?? []).filter(Boolean);
		if (this.topics.length === 0) throw new Error("A Kafka trigger needs at least one topic");
		this.subscription = subscription;
		this.handler = handler;

		this.consumer = new Consumer({
			...clientOptions(this.config),
			groupId: subscription.consumerGroup,
			autocommit: false,
		});
		// A rebalance takes partitions away mid-flight; their buffered events now
		// belong to another consumer, which starts from the last commit.
		this.consumer.on("consumer:group:join", () => this.reassign());
		this.stream = await this.consumer.consume({
			topics: this.topics,
			mode: MessagesStreamModes.COMMITTED,
			fallbackMode: source.fromBeginning
				? MessagesStreamFallbackModes.EARLIEST
				: MessagesStreamFallbackModes.LATEST,
			autocommit: false,
		});
		this.stream.on("data", (message) => this.receive(message));
		this.stream.on("error", (error) =>
			logger.error(`[kafka] ${subscription.consumerGroup}: ${String(error)}`, "QUEUE.kafka"),
		);
	}

	async commit(batch: QueueBatch) {
		const last = batch.events.at(-1);
		const message = last && this.sources.get(last);
		if (!message) throw new Error("This batch was not read by this connection");
		// one batch is one partition, so its last offset covers the rest
		await message.commit();
	}

	async moveToDLQ(batch: QueueBatch, error: unknown) {
		const topic = this.config.dlqTopic;
		if (!topic) throw new Error("No dead-letter topic is set on this Kafka integration");
		this.producer ??= new Producer({ ...clientOptions(this.config) });
		await this.producer.send({
			messages: batch.events.map((event) => {
				const message = this.sources.get(event);
				const headers = new Map(message?.headers);
				for (const [name, value] of Object.entries({
					"x-fluxify-error": String(error),
					"x-fluxify-topic": event.topic,
					"x-fluxify-partition": String(event.partition),
					"x-fluxify-offset": event.offset,
					"x-fluxify-consumer-group": batch.consumerGroup,
				}))
					headers.set(Buffer.from(name), Buffer.from(value));
				return { topic, key: message?.key, value: message?.value, headers };
			}),
		});
	}

	async lag() {
		if (!this.consumer) return null;
		const lags = await this.consumer.getLag({ topics: this.topics });
		let total = 0n;
		// -1 marks a partition some other consumer owns
		for (const partitions of lags.values())
			for (const lag of partitions) if (lag > 0n) total += lag;
		return Number(total);
	}

	async stop() {
		this.stopped = true;
		this.halted.resolve();
		for (const lane of this.lanes.values()) clearTimeout(lane.timer);
		await this.stream?.close().catch(() => undefined);
		await Promise.allSettled([...this.running]);
		await Promise.resolve(this.consumer?.close(true)).catch(() => undefined);
		await this.producer?.close().catch(() => undefined);
	}

	raw() {
		return this.consumer;
	}

	private receive(message: Message) {
		const key = `${message.topic}:${message.partition}`;
		let lane = this.lanes.get(key);
		if (!lane) {
			lane = { pending: [], bytes: 0, seen: -1n, busy: false, revoked: false };
			this.lanes.set(key, lane);
		}
		if (message.offset <= lane.seen) return;
		lane.seen = message.offset;
		lane.pending.push(message);
		lane.bytes += message.value?.length ?? 0;
		if (++this.buffered >= this.bufferCap()) this.stream?.pause();
		this.schedule(lane);
	}

	/** A full batch goes now; a partial one waits up to `maxWaitMs` for the rest. */
	private schedule(lane: Lane) {
		if (lane.busy || lane.pending.length === 0 || this.stopped) return;
		const { batchSize, maxBytes, maxWaitMs } = this.subscription;
		if (lane.pending.length >= batchSize || lane.bytes >= maxBytes) return this.dispatch(lane);
		lane.timer ??= setTimeout(() => this.dispatch(lane), maxWaitMs);
	}

	private dispatch(lane: Lane) {
		clearTimeout(lane.timer);
		lane.timer = undefined;
		if (lane.busy || lane.revoked || lane.pending.length === 0 || this.stopped) return;
		if (this.inFlight >= this.subscription.concurrency) {
			if (!this.waiting.includes(lane)) this.waiting.push(lane);
			return;
		}
		const messages = this.take(lane);
		lane.busy = true;
		this.inFlight++;
		const run = this.deliver(lane, messages).finally(() => {
			this.running.delete(run);
			lane.busy = false;
			this.inFlight--;
			this.buffered -= messages.length;
			if (this.buffered < this.bufferCap() / 2) this.stream?.resume();
			const next = this.waiting.shift();
			if (next) this.dispatch(next);
			this.schedule(lane);
		});
		this.running.add(run);
	}

	/** Up to `batchSize` events, stopping before `maxBytes` — but never empty. */
	private take(lane: Lane) {
		const { batchSize, maxBytes } = this.subscription;
		let count = 0;
		let bytes = 0;
		while (count < lane.pending.length && count < batchSize) {
			const size = lane.pending[count]!.value?.length ?? 0;
			if (count > 0 && bytes + size > maxBytes) break;
			bytes += size;
			count++;
		}
		lane.bytes -= bytes;
		return lane.pending.splice(0, count);
	}

	/**
	 * A handler that throws has not finished the batch, so it is delivered again —
	 * the same events, holding up the partition behind it, as a fresh read from
	 * the last commit would.
	 */
	private async deliver(lane: Lane, messages: Message[]) {
		const batch: QueueBatch = {
			events: messages.map((message) => this.toEvent(message)),
			consumerGroup: this.subscription.consumerGroup,
			highWatermark: null,
			attempt: 1,
		};
		let delay = 1_000;
		while (!this.stopped && !lane.revoked) {
			try {
				return await this.handler(batch, this);
			} catch (error) {
				logger.warn(
					`[kafka] ${batch.consumerGroup} redelivering ${batch.events[0]!.topic}:${batch.events[0]!.partition} in ${delay}ms: ${String(error)}`,
					"QUEUE.kafka",
				);
				await Promise.race([sleep(delay), this.halted.promise]);
				delay = Math.min(delay * 2, MAX_REDELIVERY_DELAY_MS);
			}
		}
	}

	private toEvent(message: Message): QueueEvent {
		const headers: Record<string, string> = {};
		for (const [name, value] of message.headers ?? [])
			headers[name.toString()] = value?.toString() ?? "";
		const event: QueueEvent = {
			data: decode(message.value),
			topic: message.topic,
			partition: message.partition,
			offset: message.offset.toString(),
			key: message.key ? message.key.toString() : null,
			headers,
			timestamp: new Date(Number(message.timestamp)).toISOString(),
		};
		this.sources.set(event, message);
		return event;
	}

	private reassign() {
		const owned = new Set(
			(this.consumer?.assignments ?? []).flatMap(({ topic, partitions }) =>
				partitions.map((partition) => `${topic}:${partition}`),
			),
		);
		for (const [key, lane] of this.lanes) {
			if (owned.has(key)) continue;
			// ponytail: an in-flight batch finishes and its commit may be refused;
			// the new owner runs it again. At-least-once, as documented.
			lane.revoked = true;
			clearTimeout(lane.timer);
			this.buffered -= lane.pending.length;
			this.lanes.delete(key);
		}
	}

	private bufferCap() {
		return Math.max(this.subscription.batchSize * this.subscription.concurrency * 2, 100);
	}
}

/** JSON when it parses, the text when it does not, null for a tombstone. */
function decode(value: Buffer | undefined | null) {
	if (!value) return null;
	const text = value.toString("utf8");
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

export function createConnection(config: unknown) {
	return new KafkaConnection(config as KafkaConfig);
}

/** Reaches the brokers and lists topics, which also proves the credentials. */
export async function testKafkaConnection(config: KafkaConfig) {
	const admin = new Admin({ ...clientOptions(config), connectTimeout: 4_000, retries: 0 });
	try {
		await admin.listTopics();
		return { success: true, error: "" };
	} catch (error) {
		return { success: false, error: rootCause(error) };
	} finally {
		await admin.close().catch(() => undefined);
	}
}

/**
 * The client wraps a failure in layers of "Listing topics failed" /
 * "Cannot connect to any broker"; the innermost message is the one a user can
 * act on, so it is kept alongside the outer one.
 */
function rootCause(error: unknown): string {
	const outer = error instanceof Error ? error.message : String(error);
	let inner: unknown = error;
	while (inner instanceof Error) {
		const next = (inner as AggregateError).errors?.[0] ?? inner.cause;
		if (!next) break;
		inner = next;
	}
	const detail = inner instanceof Error ? inner.message : String(inner);
	return detail === outer ? outer : `${outer} ${detail}`;
}
