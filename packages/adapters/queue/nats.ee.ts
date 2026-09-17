import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "@fluxify/common";
import {
	AckPolicy,
	DeliverPolicy,
	jetstream,
	jetstreamManager,
	JetStreamApiError,
	type Consumer,
	type ConsumerMessages,
	type JetStreamClient,
	type JsMsg,
} from "@nats-io/jetstream";
import {
	credsAuthenticator,
	headers as natsHeaders,
	nanos,
	nkeyAuthenticator,
	type ConnectionOptions,
	type NatsConnection,
} from "@nats-io/nats-core";
import { connect } from "@nats-io/transport-node";
import {
	decode,
	QueueConnection,
	QueueSourceGoneError,
	type QueueBatch,
	type QueueEvent,
	type QueueHandler,
	type QueueSubscription,
} from "./base";

/**
 * A foreign NATS JetStream stream — someone else's cluster, not our internal
 * transport. Reads through a durable pull consumer named after the consumer
 * group, so a restart resumes from the last ack.
 *
 * JetStream has no partitions: `concurrency` is how many batches are in flight
 * at once, and order holds only at 1. A throw naks the batch with a backoff and
 * the broker redelivers it; `attempt` is the broker's delivery count.
 */

/** A NATS integration's config, `cfg:` references already expanded. */
export type NatsConfig = {
	/** comma-separated `nats://host:port` list */
	servers: string;
	name?: string;
	tls?: boolean;
	token?: string;
	user?: string;
	pass?: string;
	/** the contents of a `.creds` file (JWT + NKey seed) */
	creds?: string;
	/** an NKey user seed, `SU...` */
	nkeySeed?: string;
	/** a subject a stream captures; unset refuses dead-lettering */
	dlqSubject?: string;
};

/** What a NATS trigger reads. */
export type NatsSource = {
	stream: string;
	filterSubjects?: string[];
	fromBeginning?: boolean;
	/** how long a delivered, unacked message waits before the broker resends it */
	ackWaitMs?: number;
};

const MAX_REDELIVERY_DELAY_MS = 30_000;

export function connectOptions(config: NatsConfig): ConnectionOptions {
	const encode = (text: string) => new TextEncoder().encode(text.trim());
	const authenticator = config.creds
		? credsAuthenticator(encode(config.creds))
		: config.nkeySeed
			? nkeyAuthenticator(encode(config.nkeySeed))
			: undefined;
	return {
		servers: config.servers
			.split(",")
			.map((server) => server.trim())
			.filter(Boolean),
		name: config.name || "fluxify",
		...(config.tls ? { tls: {} } : {}),
		...(config.token ? { token: config.token } : {}),
		...(config.user ? { user: config.user, pass: config.pass } : {}),
		...(authenticator ? { authenticator } : {}),
	};
}

export class NatsQueueConnection extends QueueConnection {
	private nc?: NatsConnection;
	private js?: JetStreamClient;
	private consumer?: Consumer;
	private subscription!: QueueSubscription;
	private handler!: QueueHandler;
	private heartbeatMs = 10_000;
	private readonly workers: Promise<void>[] = [];
	private readonly fetches = new Set<ConsumerMessages>();
	/** fetched and not yet settled; naked on stop so a restart gets them at once */
	private readonly unacked = new Set<JsMsg>();
	private readonly sources = new WeakMap<QueueEvent, JsMsg>();
	private stopped = false;
	private reportedGone = false;
	private readonly halted = Promise.withResolvers<void>();

	constructor(private readonly config: NatsConfig) {
		super();
	}

	async consume(subscription: QueueSubscription, handler: QueueHandler) {
		const source = subscription.source as Partial<NatsSource>;
		if (!source.stream) throw new Error("A NATS trigger needs a stream");
		this.subscription = subscription;
		this.handler = handler;

		const ackWaitMs = source.ackWaitMs ?? 30_000;
		this.heartbeatMs = Math.max(ackWaitMs / 3, 100);
		this.nc = await connect({ ...connectOptions(this.config), maxReconnectAttempts: -1 });
		const jsm = await jetstreamManager(this.nc);
		const group = subscription.consumerGroup;
		const settings = {
			ack_wait: nanos(ackWaitMs),
			max_ack_pending: subscription.batchSize * subscription.concurrency,
			...(source.filterSubjects?.length ? { filter_subjects: source.filterSubjects } : {}),
		};
		// add is a no-op for an identical consumer; a changed one is updated in place
		// fails the start on a deleted stream, not silently on the first empty fetch
		try {
			await jsm.consumers
				.add(source.stream, {
					durable_name: group,
					ack_policy: AckPolicy.Explicit,
					deliver_policy: source.fromBeginning ? DeliverPolicy.All : DeliverPolicy.New,
					...settings,
				})
				.catch((error) => {
					if (isSourceGone(error)) throw error;
					return jsm.consumers.update(source.stream!, group, settings);
				});

			this.js = jetstream(this.nc);
			this.consumer = await this.js.consumers.get(source.stream, group);
		} catch (error) {
			if (!isSourceGone(error)) throw error;
			await this.nc.close().catch(() => undefined);
			throw new QueueSourceGoneError(describeGone(source.stream, group, error));
		}
		for (let i = 0; i < subscription.concurrency; i++) this.workers.push(this.work());
	}

	async commit(batch: QueueBatch) {
		const messages = batch.events.map((event) => this.sources.get(event));
		if (messages.some((message) => !message)) throw new Error("This batch was not read by this connection");
		for (const message of messages as JsMsg[]) {
			message.ack();
			this.unacked.delete(message);
		}
		await this.nc!.flush();
	}

	async moveToDLQ(batch: QueueBatch, error: unknown) {
		const subject = this.config.dlqSubject;
		if (!subject) throw new Error("No dead-letter subject is set on this NATS integration");
		for (const event of batch.events) {
			const headers = natsHeaders();
			for (const [name, value] of Object.entries({
				...event.headers,
				// header values cannot hold line breaks
				"x-fluxify-error": String(error).replace(/[\r\n]+/g, " "),
				"x-fluxify-topic": event.topic,
				"x-fluxify-partition": String(event.partition),
				"x-fluxify-offset": event.offset,
				"x-fluxify-consumer-group": batch.consumerGroup,
			}))
				headers.set(name, value);
			// no stream capturing the subject comes back as "jetstream is not enabled"
			await this.js!.publish(subject, this.sources.get(event)?.data ?? new Uint8Array(), { headers }).catch((cause) => {
				throw new Error(`Could not dead-letter to "${subject}": no stream captures it, or JetStream is off (${String(cause)})`);
			});
		}
	}

	async lag() {
		if (!this.consumer) return null;
		const info = await this.consumer.info();
		return info.num_pending + info.num_ack_pending;
	}

	async stop() {
		this.stopped = true;
		this.halted.resolve();
		for (const fetch of this.fetches) fetch.stop();
		await Promise.allSettled(this.workers);
		for (const message of this.unacked) message.nak();
		this.unacked.clear();
		// drain flushes the naks; it throws on a connection already closed
		await this.nc?.drain().catch(() => undefined);
	}

	raw() {
		return this.nc;
	}

	private async work() {
		while (!this.stopped) {
			let messages: JsMsg[];
			try {
				messages = await this.fetch();
			} catch (error) {
				if (this.stopped) return;
				if (isSourceGone(error)) return this.gone(error);
				logger.warn(`[nats] ${this.subscription.consumerGroup} fetch failed: ${String(error)}`, "QUEUE.nats");
				await Promise.race([sleep(1_000), this.halted.promise]);
				continue;
			}
			for (const batch of this.split(messages)) await this.deliver(batch);
		}
	}

	/**
	 * ponytail: a pull waits at least 1s (the server's floor), so a part-filled
	 * batch can take longer than `maxWaitMs` to go out.
	 */
	private async fetch() {
		const { batchSize, maxWaitMs } = this.subscription;
		const fetch = await this.consumer!.fetch({ max_messages: batchSize, expires: Math.max(maxWaitMs, 1_000) });
		this.fetches.add(fetch);
		// a pull against a deleted stream or consumer does not throw: the server
		// says so out of band and the fetch just comes back empty, forever
		void this.watch(fetch);
		const messages: JsMsg[] = [];
		try {
			for await (const message of fetch) {
				messages.push(message);
				this.unacked.add(message);
			}
		} finally {
			this.fetches.delete(fetch);
		}
		return messages;
	}

	/** The out-of-band word that the stream or the consumer was deleted. */
	private async watch(fetch: ConsumerMessages) {
		try {
			for await (const status of fetch.status())
				if (status.type === "stream_not_found" || status.type === "consumer_deleted" || status.type === "consumer_not_found")
					return this.gone(new Error(status.type.replace(/_/g, " ")));
		} catch {
			// the fetch ended; nothing to report
		}
	}

	/** Deleted under us: every worker stops, and the owner hears it once. */
	private gone(error: unknown) {
		if (this.reportedGone) return;
		this.reportedGone = true;
		this.stopped = true;
		this.halted.resolve();
		for (const fetch of this.fetches) fetch.stop();
		// nothing to hand back: the messages went with the stream
		this.unacked.clear();
		const stream = String((this.subscription.source as Partial<NatsSource>).stream);
		logger.error(`[nats] ${this.subscription.consumerGroup} stream ${stream} is gone, stopping`, "QUEUE.nats");
		this.subscription.onSourceGone?.(
			new QueueSourceGoneError(describeGone(stream, this.subscription.consumerGroup, error)),
		);
	}

	/** Cuts a fetch before it goes over `maxBytes` — but never into an empty batch. */
	private split(messages: JsMsg[]) {
		const batches: JsMsg[][] = [];
		let bytes = 0;
		for (const message of messages) {
			const last = batches.at(-1);
			if (!last || bytes + message.data.length > this.subscription.maxBytes) {
				batches.push([message]);
				bytes = message.data.length;
			} else {
				last.push(message);
				bytes += message.data.length;
			}
		}
		return batches;
	}

	private async deliver(messages: JsMsg[]) {
		if (this.stopped) return;
		const batch: QueueBatch = {
			events: messages.map((message) => this.toEvent(message)),
			consumerGroup: this.subscription.consumerGroup,
			highWatermark: null,
			attempt: messages[0]!.info.deliveryCount,
		};
		// a long run must not outlast ack_wait, or the broker hands the batch to another worker
		const heartbeat = setInterval(() => {
			for (const message of messages) if (this.unacked.has(message)) message.working();
		}, this.heartbeatMs);
		try {
			await this.handler(batch, this);
		} catch (error) {
			if (this.stopped) return;
			const delay = Math.min(1_000 * 2 ** (batch.attempt - 1), MAX_REDELIVERY_DELAY_MS);
			logger.warn(
				`[nats] ${batch.consumerGroup} redelivering ${batch.events[0]!.topic}@${batch.events[0]!.offset} in ${delay}ms: ${String(error)}`,
				"QUEUE.nats",
			);
			for (const message of messages) if (this.unacked.has(message)) message.nak(delay);
		} finally {
			clearInterval(heartbeat);
		}
		// settled or left to ack_wait: an uncommitted batch comes back on its own
		for (const message of messages) this.unacked.delete(message);
	}

	private toEvent(message: JsMsg): QueueEvent {
		const headers: Record<string, string> = {};
		for (const name of message.headers?.keys() ?? []) headers[name] = message.headers!.get(name);
		const event: QueueEvent = {
			data: decode(message.data),
			topic: message.subject,
			partition: 0,
			offset: String(message.info.streamSequence),
			key: message.headers?.get("Nats-Msg-Id") || null,
			headers,
			timestamp: message.time.toISOString(),
		};
		this.sources.set(event, message);
		return event;
	}
}

/** The stream or the durable consumer is gone; retrying cannot bring it back. */
export function isSourceGone(error: unknown) {
	if (error instanceof JetStreamApiError)
		return error.code === 10059 || error.code === 10014;
	return error instanceof Error && /stream not found|consumer not found|consumer deleted/i.test(error.message);
}

function describeGone(stream: string, group: string, error: unknown) {
	const detail = error instanceof Error ? error.message : String(error);
	return `NATS no longer has the stream this trigger reads: stream "${stream}", consumer "${group}" (${detail}). Recreate it on the cluster, then enable the trigger again.`;
}

export function createConnection(config: unknown) {
	return new NatsQueueConnection(config as NatsConfig);
}

/** Makes sure a trigger's stream exists before it is saved; streams are never created here. */
export async function assertNatsStream(config: NatsConfig, stream: string) {
	let nc: NatsConnection;
	try {
		nc = await connect({ ...connectOptions(config), timeout: 4_000, reconnect: false });
	} catch (error) {
		throw new Error(`Could not reach the NATS servers to check the stream: ${String(error)}`);
	}
	try {
		await (await jetstreamManager(nc)).streams.info(stream);
	} catch (error) {
		throw new Error(`Could not read stream "${stream}". Create it on the NATS cluster first. (${String(error)})`);
	} finally {
		await nc.close().catch(() => undefined);
	}
}

/** Connects and reads the account's JetStream info, which also proves the credentials. */
export async function testNatsConnection(config: NatsConfig) {
	let nc: NatsConnection | undefined;
	try {
		nc = await connect({ ...connectOptions(config), timeout: 4_000, reconnect: false });
		await (await jetstreamManager(nc)).getAccountInfo();
		return { success: true, error: "" };
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	} finally {
		await nc?.close().catch(() => undefined);
	}
}
