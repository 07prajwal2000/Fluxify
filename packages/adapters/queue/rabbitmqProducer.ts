import { generateID } from "@fluxify/lib/random/id";
import { type ConfirmChannel, connect, type Message, type RecoveringChannelModel } from "amqplib";
import { encodePayload, type OutgoingMessage, QueueProducer, settleEach } from "./base";
import { connectionOptions, describeRabbitMqError, type RabbitMqConfig } from "./rabbitmq";

type Pending = { returned?: string };

/**
 * Publishes for the Send Message block on a confirm channel: a send settles on
 * the broker's confirm. Messages are persistent and `mandatory`, so one that no
 * queue takes is returned, and fails, instead of being dropped.
 *
 * - RabbitMQ returns an unroutable message and then still confirms it, so each
 *   send is matched to its return by message ID. A blank ID gets a uuidv7, which
 *   the trigger's `meta.id` is built from.
 * - a refused command (a missing exchange, no write access) closes the channel
 *   with every send in flight on it. The next send opens a new one, and each
 *   exchange is checked once on a throwaway channel, so one bad item in a list
 *   does not sink the rest.
 * - a lost connection reconnects on its own; sends wait for it, up to the timeout.
 */
export class RabbitMqProducer extends QueueProducer {
	private model?: Promise<RecoveringChannelModel>;
	private channel?: Promise<ConfirmChannel>;
	/** what closed the channel, for the sends it took down with it */
	private closedBy?: unknown;
	private readonly pending = new Map<string, Pending[]>();
	private readonly exchanges = new Set<string>();

	constructor(private readonly config: RabbitMqConfig) {
		super();
	}

	private connection() {
		if (this.model) return this.model;
		const opening = connect(connectionOptions(this.config), {
			clientProperties: { connection_name: "fluxify send message" },
			recovery: { initialMaxRetries: 0 },
		}).then((model) => {
			model.on("error", () => undefined);
			return model;
		});
		this.model = opening;
		// a failed first connect is retried by the next run, not cached
		opening.catch(() => {
			if (this.model === opening) this.model = undefined;
		});
		return opening;
	}

	private open() {
		if (this.channel) return this.channel;
		const opening = this.connection().then(async (model) => {
			const channel = await model.createConfirmChannel();
			this.closedBy = undefined;
			channel.on("error", (error) => {
				this.closedBy = error;
			});
			channel.on("return", (message: Message) => this.returned(message));
			channel.on("close", () => {
				if (this.channel === opening) this.channel = undefined;
				// an exchange deleted since its check is caught again
				this.exchanges.clear();
			});
			return channel;
		});
		this.channel = opening;
		opening.catch(() => {
			if (this.channel === opening) this.channel = undefined;
		});
		return opening;
	}

	async send(messages: OutgoingMessage[]) {
		return settleEach(messages, (message) => this.publish(message));
	}

	private async publish(message: OutgoingMessage) {
		const options = message.options ?? {};
		const exchange = text(options.exchange) ?? "";
		const routingKey = message.destination;
		const messageId = text(options.messageId) ?? generateID();
		const expiration = optionalMs(options.expiration);
		const body = Buffer.from(encodePayload(message.payload));
		const contentType =
			text(options.contentType) ??
			(typeof message.payload === "string" ? "text/plain" : "application/json");
		await this.checkExchange(exchange);
		const channel = await this.open();

		const entry: Pending = {};
		const waiting = this.pending.get(messageId) ?? [];
		waiting.push(entry);
		this.pending.set(messageId, waiting);
		try {
			await new Promise<void>((resolve, reject) => {
				channel.publish(
					exchange,
					routingKey,
					body,
					{
						persistent: true,
						mandatory: true,
						messageId,
						contentType,
						timestamp: Math.floor(Date.now() / 1000),
						...(message.headers ? { headers: message.headers } : {}),
						...(expiration === undefined ? {} : { expiration }),
					},
					(error) => (error ? reject(this.closedBy ?? error) : resolve()),
				);
			}).catch((error) => {
				throw new Error(describeRabbitMqError(error));
			});
		} finally {
			waiting.splice(waiting.indexOf(entry), 1);
			if (!waiting.length) this.pending.delete(messageId);
		}
		if (entry.returned) throw new Error(entry.returned);
		return { exchange, routingKey, messageId };
	}

	/** Comes before the confirm of the same message, on the same channel. */
	private returned({ fields, properties }: Message) {
		const entry = this.pending.get(properties.messageId)?.find((each) => !each.returned);
		if (!entry) return;
		const where = fields.exchange ? `exchange "${fields.exchange}"` : "the default exchange";
		// a basic.return carries replyText; amqplib's types leave it out
		const { replyText } = fields as typeof fields & { replyText?: string };
		entry.returned = `RabbitMQ could not route the message: no queue on ${where} matches routing key "${fields.routingKey}" (${replyText})`;
	}

	/** A missing exchange closes the channel it is used on, so a fresh one finds out first. */
	private async checkExchange(exchange: string) {
		if (!exchange || this.exchanges.has(exchange)) return;
		const model = await this.connection();
		const channel = await model.createChannel();
		channel.on("error", () => undefined);
		try {
			await channel.checkExchange(exchange);
			this.exchanges.add(exchange);
		} catch (error) {
			throw new Error(describeRabbitMqError(error));
		} finally {
			await channel.close().catch(() => undefined);
		}
	}

	async client() {
		return this.open();
	}

	async close() {
		const model = this.model;
		this.model = undefined;
		this.channel = undefined;
		await (await model)?.close();
	}
}

/** A setting as text; blank is unset. */
function text(value: unknown) {
	if (value === undefined || value === null) return undefined;
	return String(value).trim() || undefined;
}

/** RabbitMQ takes a per-message TTL as whole milliseconds, written as text. */
function optionalMs(value: unknown) {
	const raw = text(value);
	if (raw === undefined) return undefined;
	const ms = Number(raw);
	if (!Number.isInteger(ms) || ms < 0)
		throw new Error(`expiration must be a whole number of milliseconds, got ${raw}`);
	return String(ms);
}

export function createProducer(config: unknown) {
	return new RabbitMqProducer(config as RabbitMqConfig);
}
