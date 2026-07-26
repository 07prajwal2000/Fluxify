import { logger } from "@fluxify/common";
import { connect, NatsConnection, StringCodec } from "nats";
import { NATS_TOKEN, NATS_URL } from "../lib/env";

let nc: NatsConnection = null!;
const sc = StringCodec();

export async function initializeNats() {
	if (nc) return nc;
	nc = await connect({
		servers: NATS_URL,
		token: NATS_TOKEN,
		name: "fluxify.worker",
		maxReconnectAttempts: -1, // reconnect forever; NATS has no subscriber-mode lockout
	});
	logger.info("[NATS] connected");

	// Surface connection lifecycle without blocking startup.
	(async () => {
		for await (const s of nc.status()) {
			logger.debug(`[NATS] ${s.type}: ${String(s.data ?? "")}`);
		}
	})();

	return nc;
}

export function natsPublish(subject: string, data: string) {
	if (!nc) throw new Error("NATS not initialized — call initializePubSub() at startup");
	nc.publish(subject, sc.encode(data));
}

/** Subscribe to a subject. Returns an async unsubscribe (drains in-flight messages). */
export function natsSubscribe(subject: string, cb: (data: string) => void) {
	if (!nc) throw new Error("NATS not initialized — call initializePubSub() at startup");
	const sub = nc.subscribe(subject);
	(async () => {
		for await (const m of sub) cb(sc.decode(m.data));
	})();
	return async () => {
		await sub.drain();
	};
}

/** True when the connection is live — used by the readiness probe. */
export function natsConnected() {
	return !!nc && !nc.isClosed();
}

export async function closeNats() {
	if (nc) await nc.drain();
	nc = null!;
}
