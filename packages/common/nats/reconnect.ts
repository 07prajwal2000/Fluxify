import type { NatsConnection } from "@nats-io/nats-core";

/**
 * One shared `status()` listener per connection, however many watches a
 * process holds. nats.js tries to rebuild a JetStream watch itself after a
 * reconnect, but when the server is not ready yet (JetStream still loading, or
 * the stream is gone) that rebuild fails silently and the watch iterator hangs
 * forever — so callers need to know a reconnect happened and re-open for
 * themselves (#789).
 */
const handlers = new WeakMap<NatsConnection, Set<() => void>>();

/** Calls `fn` after every reconnect of `nc`. Returns the unsubscribe function. */
export function onReconnect(nc: NatsConnection, fn: () => void): () => void {
	let set = handlers.get(nc);
	if (!set) {
		const fresh = new Set<() => void>();
		set = fresh;
		handlers.set(nc, fresh);
		// the status iterator ends when the connection closes, which ends the loop
		void (async () => {
			for await (const status of nc.status()) {
				if (status.type === "reconnect") for (const h of [...fresh]) h();
			}
		})().catch(() => {});
	}
	const subscribers = set;
	subscribers.add(fn);
	return () => {
		subscribers.delete(fn);
	};
}
