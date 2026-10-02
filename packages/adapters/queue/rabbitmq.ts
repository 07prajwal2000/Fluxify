import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "@fluxify/common";
import {
	type Channel,
	type ChannelModel,
	type ConsumeMessage,
	connect,
	type Options,
	type RecoveringChannelModel,
} from "amqplib";
import {
	decode,
	errorText,
	type QueueBatch,
	QueueConnection,
	type QueueEvent,
	type QueueHandler,
	QueueSourceGoneError,
	type QueueSubscription,
} from "./base";

/**
 * A RabbitMQ queue (AMQP 0-9-1), read by one consumer on one channel.
 *
 * RabbitMQ pushes: up to `prefetch` messages sit unacked with this consumer at
 * once, so prefetch is batchSize × concurrency — a smaller one could never fill
 * a batch. Batches fill from what has arrived like the other connectors: a full
 * one goes at once, a part-filled one waits up to `maxWaitMs`.
 *
 * - commit acks; moveToDLQ rejects without requeue, so the queue's own
 *   dead-letter exchange takes the message — with none, RabbitMQ drops it.
 * - a failed or uncommitted batch is requeued after the retry delay, never at
 *   once, so a poison message cannot spin.
 * - an ack belongs to the channel that delivered it. A message whose channel
 *   died was already requeued by the broker, so settling it is skipped: its tag
 *   on the new channel would close that one too. Each message settles once, as
 *   a second ack is a channel error as well.
 * - a dropped connection reconnects with backoff and consumes again. A channel
 *   the broker closed (a refused command) or a cancelled consumer forces the same
 *   reconnect, and a queue missing on reconnect disables the trigger.
 * - the queue is never declared here: the user creates it, with its dead-letter
 *   settings, in RabbitMQ.
 */

/** A RabbitMQ integration's config, `cfg:` references already expanded. */
export type RabbitMqConfig =
	| {
			source: "credentials";
			host: string;
			port?: string | number;
			username?: string;
			password?: string;
			/** the virtual host; empty is `/` */
			database?: string;
			useSSL?: boolean;
	  }
	| { source: "url"; url: string };

/** What a RabbitMQ trigger reads. */
export type RabbitMqSource = { queue: string };

/** One message, with RabbitMQ's own delivery details on top of the shared shape. */
export type RabbitMqEvent = QueueEvent & {
	exchange: string;
	routingKey: string;
	messageId: string | null;
	/** this channel's number for the delivery; it restarts on every reconnect */
	deliveryTag: number;
	redelivered: boolean;
	/** deliveries so far, this one included; exact on quorum queues, 1 or 2 on classic ones */
	deliveryCount: number;
	/** the AMQP properties that were set: contentType, correlationId, replyTo, priority, ... */
	properties: Record<string, unknown>;
};

/** AMQP's prefetch is a 16-bit count. */
const MAX_PREFETCH = 65_535;
/** Well inside RabbitMQ's 30 minute consumer timeout, which closes a channel holding a message longer. */
const MAX_REQUEUE_DELAY_MS = 300_000;
/** Commands the runtime owns: each would settle, or stop, other batches' messages. */
const OWNED_COMMANDS = new Set([
	"ack",
	"ackAll",
	"nack",
	"nackAll",
	"reject",
	"cancel",
	"close",
	"recover",
	"prefetch",
]);

type Held = { message: ConsumeMessage; channel: Channel; settled: boolean };

export function connectionOptions(config: RabbitMqConfig): string | Options.Connect {
	if (config.source === "url") return config.url;
	return {
		protocol: config.useSSL ? "amqps" : "amqp",
		hostname: config.host,
		port: Number(config.port) || undefined,
		username: config.username || undefined,
		password: config.password || undefined,
		vhost: config.database || undefined,
	};
}

export function prefetchFor({
	batchSize,
	concurrency,
}: {
	batchSize: number;
	concurrency: number;
}) {
	return Math.min(MAX_PREFETCH, batchSize * concurrency);
}

export class RabbitMqConnection extends QueueConnection {
	private model?: RecoveringChannelModel;
	/** the live connection under the recovering one, replaced on each reconnect */
	private current?: ChannelModel;
	private channel?: Channel;
	private subscription!: QueueSubscription;
	private handler!: QueueHandler;
	private queue = "";
	private readonly buffer: Held[] = [];
	private readonly inFlight = new Set<Promise<void>>();
	private readonly held = new WeakMap<QueueEvent, Held>();
	private waitTimer?: ReturnType<typeof setTimeout>;
	private waitOver = false;
	private readonly aborter = new AbortController();
	private stopped = false;
	private reportedGone = false;

	constructor(private readonly config: RabbitMqConfig) {
		super();
	}

	async consume(subscription: QueueSubscription, handler: QueueHandler) {
		const source = subscription.source as Partial<RabbitMqSource>;
		if (!source.queue) throw new Error("A RabbitMQ trigger needs a queue name");
		this.subscription = subscription;
		this.handler = handler;
		this.queue = source.queue;
		try {
			this.model = await connect(connectionOptions(this.config), {
				clientProperties: { connection_name: `fluxify ${subscription.consumerGroup}` },
				// a bad start fails now; once running, a lost broker is retried forever
				recovery: { initialMaxRetries: 0, setup: (model: ChannelModel) => this.open(model) },
			});
		} catch (error) {
			if (error instanceof QueueSourceGoneError) throw error;
			throw new Error(describeRabbitMqError(error, this.queue));
		}
		this.model.on("error", () => undefined);
		this.model.on("disconnect", (error) =>
			this.warn(`disconnected, reconnecting: ${errorText(error)}`),
		);
		this.model.on("connect-failed", (error) => {
			if (error instanceof QueueSourceGoneError) this.gone(error);
			else this.warn(`reconnect failed: ${describeRabbitMqError(error, this.queue)}`);
		});
	}

	async commit(batch: QueueBatch) {
		for (const held of this.heldOf(batch))
			this.settle(held, (channel) => channel.ack(held.message));
	}

	/** RabbitMQ carries no reason on a reject, so the error is only logged here. */
	async moveToDLQ(batch: QueueBatch, error: unknown) {
		const held = this.heldOf(batch);
		this.warn(
			`rejecting ${held.length} message(s) to the dead-letter exchange: ${errorText(error)}`,
		);
		for (const each of held) this.settle(each, (channel) => channel.reject(each.message, false));
	}

	/** Messages ready in the queue; those held unacked by consumers are not counted. */
	async lag() {
		if (!this.channel) return null;
		return (await this.channel.checkQueue(this.queue)).messageCount;
	}

	async stop() {
		this.stopped = true;
		this.aborter.abort();
		clearTimeout(this.waitTimer);
		// in-flight batches still commit on the open channel; the rest goes back when it closes
		await Promise.allSettled(this.inFlight);
		await this.model?.close().catch(() => undefined);
	}

	/** The consuming channel, minus the commands that would settle or stop other batches. */
	raw() {
		return new Proxy({} as Channel, {
			get: (_target, prop) => {
				if (typeof prop === "string" && OWNED_COMMANDS.has(prop))
					return () => {
						throw new Error(
							`${prop}() is not available on a trigger's channel: Fluxify settles the messages and owns the consumer. Use trigger.connection.commit() or moveToDLQ().`,
						);
					};
				const channel = this.channel;
				if (!channel) {
					if (typeof prop === "symbol") return undefined;
					throw new Error("The RabbitMQ connection is reconnecting; try again shortly");
				}
				const value = Reflect.get(channel, prop);
				return typeof value === "function" ? value.bind(channel) : value;
			},
		});
	}

	/** Runs after every (re)connect: a fresh channel consuming the queue. */
	private async open(model: ChannelModel) {
		const channel = await model.createChannel();
		// a refused command closes the channel; `close` below handles it
		channel.on("error", () => undefined);
		try {
			await channel.checkQueue(this.queue);
		} catch (error) {
			if ((error as { code?: number }).code === 404)
				throw new QueueSourceGoneError(
					`RabbitMQ has no queue "${this.queue}" on this virtual host. Create it, then enable the trigger again.`,
				);
			throw error;
		}
		await channel.prefetch(prefetchFor(this.subscription));
		channel.on("close", () => {
			if (this.channel !== channel) return;
			this.channel = undefined;
			if (!this.stopped) this.reconnect();
		});
		this.current = model;
		this.channel = channel;
		await channel.consume(
			this.queue,
			// null: the broker cancelled the consumer, usually because the queue was deleted
			(message) => (message ? this.receive(message, channel) : this.reconnect()),
			{ noAck: false },
		);
	}

	/** Closing the live connection hands over to recovery, which runs `open` again. */
	private reconnect() {
		void this.current?.close().catch(() => undefined);
	}

	private receive(message: ConsumeMessage, channel: Channel) {
		// left unacked: closing the channel on stop requeues it
		if (this.stopped) return;
		this.buffer.push({ message, channel, settled: false });
		this.pump();
	}

	/** Starts batches while there are free slots and a full batch, or the wait is over. */
	private pump() {
		const { batchSize, maxBytes, maxWaitMs, concurrency } = this.subscription;
		while (!this.stopped && this.buffer.length && this.inFlight.size < concurrency) {
			const filling =
				this.buffer.length < batchSize && bytesOf(this.buffer) < maxBytes && maxWaitMs > 0;
			if (filling && !this.waitOver) {
				this.waitTimer ??= setTimeout(() => {
					this.waitTimer = undefined;
					this.waitOver = true;
					this.pump();
				}, maxWaitMs);
				return;
			}
			clearTimeout(this.waitTimer);
			this.waitTimer = undefined;
			this.waitOver = false;
			const run = this.deliver(this.take()).finally(() => {
				this.inFlight.delete(run);
				this.pump();
			});
			this.inFlight.add(run);
		}
	}

	/** Up to a batch, cut before it goes over `maxBytes` — but never empty. */
	private take() {
		const { batchSize, maxBytes } = this.subscription;
		const batch: Held[] = [];
		let bytes = 0;
		while (this.buffer.length && batch.length < batchSize) {
			const size = this.buffer[0]!.message.content.length;
			if (batch.length && bytes + size > maxBytes) break;
			batch.push(this.buffer.shift()!);
			bytes += size;
		}
		return batch;
	}

	private async deliver(items: Held[]) {
		const events = items.map((held) => this.toEvent(held));
		const attempt = Math.max(...events.map((event) => event.deliveryCount));
		let failure: unknown;
		try {
			await this.handler(
				{ events, consumerGroup: this.subscription.consumerGroup, highWatermark: null, attempt },
				this,
			);
		} catch (error) {
			failure = error;
		}
		// failed, or a manual batch the workflow never settled: back after the retry delay
		const leftover = items.filter((held) => !held.settled);
		if (!leftover.length || this.stopped) return;
		const delayMs = requeueDelayMs(this.subscription.retryDelayMs, attempt);
		this.warn(
			`requeueing ${leftover.length} message(s) in ${delayMs}ms (delivery ${attempt}): ${failure ? errorText(failure) : "not committed"}`,
		);
		await sleep(delayMs, undefined, { signal: this.aborter.signal }).catch(() => undefined);
		// stopping closes the channel, which requeues them anyway
		if (this.stopped) return;
		for (const held of leftover)
			this.settle(held, (channel) => channel.nack(held.message, false, true));
	}

	private settle(held: Held, action: (channel: Channel) => void) {
		if (held.settled) return;
		held.settled = true;
		if (held.channel !== this.channel) {
			this.warn(
				`skipped settling delivery ${held.message.fields.deliveryTag}: its channel closed, so RabbitMQ already requeued it`,
			);
			return;
		}
		try {
			action(held.channel);
		} catch (error) {
			this.warn(
				`could not settle delivery ${held.message.fields.deliveryTag}: ${errorText(error)}`,
			);
		}
	}

	private heldOf(batch: QueueBatch) {
		const held = batch.events.map((event) => this.held.get(event));
		if (held.some((each) => !each)) throw new Error("This batch was not read by this connection");
		return held as Held[];
	}

	private toEvent(held: Held): RabbitMqEvent {
		const { fields, content } = held.message;
		const { headers = {}, ...props } = held.message.properties;
		const sentSec = Number(props.timestamp);
		const event: RabbitMqEvent = {
			data: decode(content),
			topic: this.queue,
			partition: 0,
			// `meta.id` is built from this: the publisher's message id survives a redelivery, a tag does not
			offset: props.messageId ?? String(fields.deliveryTag),
			key: fields.routingKey || null,
			headers: textHeaders(headers),
			timestamp: new Date(sentSec > 0 ? sentSec * 1000 : Date.now()).toISOString(),
			exchange: fields.exchange,
			routingKey: fields.routingKey,
			messageId: props.messageId ?? null,
			deliveryTag: fields.deliveryTag,
			redelivered: fields.redelivered,
			deliveryCount: Number(headers["x-delivery-count"] ?? (fields.redelivered ? 1 : 0)) + 1,
			properties: Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)),
		};
		this.held.set(event, held);
		return event;
	}

	/** Deleted under us: consuming stops for good, and the owner hears it once. */
	private gone(error: QueueSourceGoneError) {
		if (this.reportedGone) return;
		this.reportedGone = true;
		this.stopped = true;
		this.aborter.abort();
		clearTimeout(this.waitTimer);
		logger.error(`[rabbitmq] queue ${this.queue} is gone, stopping`, "QUEUE.rabbitmq");
		void this.model?.close().catch(() => undefined);
		this.subscription.onSourceGone?.(error);
	}

	private warn(text: string) {
		logger.warn(
			`[rabbitmq] ${this.subscription.consumerGroup} on ${this.queue}: ${text}`,
			"QUEUE.rabbitmq",
		);
	}
}

function bytesOf(items: Held[]) {
	return items.reduce((sum, held) => sum + held.message.content.length, 0);
}

/** Exponential from the trigger's retry delay, capped under the consumer timeout. */
export function requeueDelayMs(baseMs = 1_000, attempt = 1) {
	return Math.min(MAX_REQUEUE_DELAY_MS, baseMs * 2 ** (Math.max(1, attempt) - 1));
}

/** AMQP header values as text: strings as-is, anything else (numbers, x-death tables) as JSON. */
export function textHeaders(headers: Record<string, unknown>) {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined || value === null) continue;
		out[name] =
			typeof value === "string"
				? value
				: JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
	}
	return out;
}

export function createConnection(config: unknown) {
	return new RabbitMqConnection(config as RabbitMqConfig);
}

/** Opens a plain connection for a one-off check, and always closes it. */
async function withChannel<T>(config: RabbitMqConfig, use: (channel: Channel) => Promise<T>) {
	const model = await connect(connectionOptions(config));
	model.on("error", () => undefined);
	try {
		const channel = await model.createChannel();
		channel.on("error", () => undefined);
		return await use(channel);
	} finally {
		await model.close().catch(() => undefined);
	}
}

export async function testRabbitMqConnection(config: RabbitMqConfig) {
	try {
		await withChannel(config, async () => undefined);
		return { success: true, error: "" };
	} catch (error) {
		return { success: false, error: describeRabbitMqError(error) };
	}
}

/** Makes sure a trigger's queue exists before it is saved; queues are never created here. */
export async function assertRabbitMqQueue(config: RabbitMqConfig, queue: string) {
	try {
		return await withChannel(config, (channel) => channel.checkQueue(queue));
	} catch (error) {
		throw new Error(describeRabbitMqError(error, queue));
	}
}

/** What a user should know before a RabbitMQ trigger runs. */
export function rabbitMqWarnings(settings: { batchSize?: number; concurrency?: number }) {
	const warnings = [
		"Messages that keep failing are rejected to the queue's dead-letter exchange. If the queue has none, RabbitMQ deletes them. Set x-dead-letter-exchange on the queue, or a policy, to keep them.",
	];
	const batchSize = settings.batchSize ?? 1;
	const concurrency = settings.concurrency ?? 1;
	if (batchSize * concurrency > MAX_PREFETCH)
		warnings.push(
			`Batch size × concurrency is above RabbitMQ's prefetch limit of ${MAX_PREFETCH}, so batches may not fill and will wait the full max wait time.`,
		);
	return warnings;
}

/** Client errors in words a user can act on; anything unmapped keeps its own text. */
export function describeRabbitMqError(error: unknown, queue?: string) {
	const { code, message = "" } = error as { code?: string | number; message?: string };
	if (code === 404)
		return `RabbitMQ has no queue "${queue}" on this virtual host. Create it first.`;
	if (code === 403 || /ACCESS[-_]REFUSED/.test(message))
		return "RabbitMQ refused the login: check the username and password, and that the user may use this virtual host.";
	if (code === 530 || /NOT[-_]ALLOWED/.test(message))
		return "RabbitMQ refused the virtual host: it does not exist, or the user has no access to it.";
	if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT")
		return `Could not reach RabbitMQ (${code}). Check the host, port and TLS setting.`;
	return message || String(code ?? error);
}
