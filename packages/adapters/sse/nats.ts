import type { NatsConnection } from "@nats-io/nats-core";
import { connect } from "@nats-io/transport-node";
import { connectOptions, type NatsConfig } from "../queue/nats";
import type { Wire } from "./broker";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Core NATS pub/sub, not JetStream: a message is for whoever is subscribed right now. */
export class NatsWire implements Wire {
	private publisher?: Promise<NatsConnection>;

	constructor(private readonly config: NatsConfig) {}

	private open() {
		// the client reconnects forever and replays its subscriptions on its own
		return connect({ ...connectOptions(this.config), maxReconnectAttempts: -1 });
	}

	async publish(subject: string, message: string) {
		if (!this.publisher) {
			const opening = this.open();
			this.publisher = opening;
			// a failed first connect is retried by the next publish, not cached
			opening.catch(() => {
				if (this.publisher === opening) this.publisher = undefined;
			});
		}
		(await this.publisher).publish(subject, encoder.encode(message));
	}

	async connect(onMessage: (subject: string, message: string) => void) {
		const nc = await this.open();
		const subscriptions = new Map<string, ReturnType<NatsConnection["subscribe"]>>();
		return {
			async add(subject: string) {
				subscriptions.set(
					subject,
					nc.subscribe(subject, {
						callback: (_, msg) => onMessage(msg.subject, decoder.decode(msg.data)),
					}),
				);
				// the server has the subscription once it answers
				await nc.flush();
			},
			async remove(subject: string) {
				subscriptions.get(subject)?.unsubscribe();
				subscriptions.delete(subject);
				await nc.flush();
			},
			async close() {
				await nc.close();
			},
		};
	}

	async close() {
		const publisher = this.publisher;
		this.publisher = undefined;
		await (await publisher?.catch(() => undefined))?.close();
	}
}
