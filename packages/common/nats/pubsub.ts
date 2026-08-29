import type { NatsConnection, Subscription } from "@nats-io/nats-core";
import { type Codec, decodeText, encodeText, jsonCodec } from "./codec";

/**
 * Core NATS publish/subscribe: at-most-once, no persistence, no replay. The
 * right tool for "something changed, reload it" signals where a missed message
 * costs a stale cache until the next one — and the wrong tool for anything a
 * restarting process must not miss, which is what `queue.ts` and `kv.ts` are
 * for.
 */

export interface Subscriber {
	/** Stops receiving. Drains what has already arrived. */
	stop(): Promise<void>;
}

export function publish(nc: NatsConnection, subject: string, data: string): void {
	nc.publish(subject, encodeText(data));
}

export function subscribe(
	nc: NatsConnection,
	subject: string,
	onMessage: (data: string, subject: string) => void | Promise<void>,
	options: { queue?: string } = {},
): Subscriber {
	const sub: Subscription = nc.subscribe(
		subject,
		options.queue ? { queue: options.queue } : {},
	);
	void (async () => {
		for await (const message of sub) {
			await onMessage(decodeText(message.data), message.subject);
		}
	})();
	return { stop: async () => void (await sub.drain()) };
}

export function publishJson<T>(
	nc: NatsConnection,
	subject: string,
	data: T,
	codec: Codec<T> = jsonCodec<T>(),
): void {
	nc.publish(subject, codec.encode(data));
}

export function subscribeJson<T>(
	nc: NatsConnection,
	subject: string,
	onMessage: (data: T, subject: string) => void | Promise<void>,
	options: { queue?: string; codec?: Codec<T> } = {},
): Subscriber {
	const codec = options.codec ?? jsonCodec<T>();
	const sub = nc.subscribe(subject, options.queue ? { queue: options.queue } : {});
	void (async () => {
		for await (const message of sub) {
			await onMessage(codec.decode(message.data), message.subject);
		}
	})();
	return { stop: async () => void (await sub.drain()) };
}
