import { type JetStreamClient, jetstream } from "@nats-io/jetstream";
import { type NatsConnection, headers as natsHeaders } from "@nats-io/nats-core";
import { connect } from "@nats-io/transport-node";
import { encodePayload, type OutgoingMessage, QueueProducer, settleEach } from "./base";
import { connectOptions, type NatsConfig } from "./nats.ee";

/**
 * Publishes to JetStream for the Send Message block. A publish settles on the
 * stream's ack, so a subject no stream captures is a failed message.
 */
export class NatsProducer extends QueueProducer {
	private connection?: Promise<{ nc: NatsConnection; js: JetStreamClient }>;

	constructor(private readonly config: NatsConfig) {
		super();
	}

	private open() {
		if (this.connection) return this.connection;
		const opening = connect({ ...connectOptions(this.config), maxReconnectAttempts: -1 }).then(
			(nc) => ({ nc, js: jetstream(nc) }),
		);
		this.connection = opening;
		// a failed first connect is retried by the next run, not cached
		opening.catch(() => {
			if (this.connection === opening) this.connection = undefined;
		});
		return opening;
	}

	async send(messages: OutgoingMessage[]) {
		const { js } = await this.open();
		return settleEach(messages, async (message) => {
			const headers = natsHeaders();
			// header values cannot hold line breaks
			for (const [name, value] of Object.entries(message.headers ?? {}))
				headers.set(name, value.replace(/[\r\n]+/g, " "));
			const msgID = message.options?.msgId;
			const ack = await js.publish(message.destination, encodePayload(message.payload), {
				headers,
				...(msgID ? { msgID: String(msgID) } : {}),
			});
			return { stream: ack.stream, seq: ack.seq, duplicate: ack.duplicate };
		});
	}

	async client() {
		return (await this.open()).js;
	}

	async close() {
		const connection = this.connection;
		this.connection = undefined;
		await (await connection)?.nc.drain();
	}
}

export function createProducer(config: unknown) {
	return new NatsProducer(config as NatsConfig);
}
