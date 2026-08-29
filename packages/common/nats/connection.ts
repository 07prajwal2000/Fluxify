import { connect, type NodeConnectionOptions } from "@nats-io/transport-node";
import type { NatsConnection } from "@nats-io/nats-core";
import { logger } from "../logging";

/**
 * Connection lifecycle. Connections are cached by name so every module in a
 * process shares one socket: `connectNats()` at startup, `natsConnection()`
 * everywhere else.
 *
 * A name is supported because a process can legitimately need two clusters —
 * the ingress gateway consuming a customer's foreign NATS while publishing to
 * ours. Omit it and everything lands on `default`.
 */

export const DEFAULT_CONNECTION = "default";

export interface NatsConnectOptions extends NodeConnectionOptions {
	/** Key in the connection registry. Defaults to `default`. */
	connectionName?: string;
}

const connections = new Map<string, NatsConnection>();

export async function connectNats(
	options: NatsConnectOptions = {},
): Promise<NatsConnection> {
	const { connectionName = DEFAULT_CONNECTION, ...opts } = options;
	const existing = connections.get(connectionName);
	if (existing && !existing.isClosed()) return existing;

	const nc = await connect({
		// reconnect forever: NATS has no subscriber-mode lockout, and a worker
		// that gives up on the bus is a worker that silently stops working
		maxReconnectAttempts: -1,
		...opts,
	});
	connections.set(connectionName, nc);
	logger.info(`[nats] connected (${connectionName})`, "NATS");
	void watchStatus(nc, connectionName);
	return nc;
}

/** The live connection. Throws rather than reconnecting implicitly — a missing
 *  `connectNats()` at startup is a wiring bug, not something to paper over. */
export function natsConnection(
	connectionName = DEFAULT_CONNECTION,
): NatsConnection {
	const nc = connections.get(connectionName);
	if (!nc) {
		throw new Error(
			`NATS connection '${connectionName}' not initialised — call connectNats() at startup`,
		);
	}
	return nc;
}

/** True when the connection exists and is live. For readiness probes. */
export function natsConnected(connectionName = DEFAULT_CONNECTION): boolean {
	const nc = connections.get(connectionName);
	return !!nc && !nc.isClosed();
}

/** Drains in-flight work and closes. Safe to call when never connected. */
export async function closeNats(
	connectionName = DEFAULT_CONNECTION,
): Promise<void> {
	const nc = connections.get(connectionName);
	connections.delete(connectionName);
	if (nc && !nc.isClosed()) await nc.drain();
}

export async function closeAllNats(): Promise<void> {
	await Promise.all([...connections.keys()].map((name) => closeNats(name)));
}

/**
 * v3 dropped the `Events` enum and gave each status its own shape, so there is
 * no `status.data` to log any more. The discriminant is all that is common;
 * anything else is per-status and goes in the structured field.
 */
async function watchStatus(nc: NatsConnection, connectionName: string) {
	for await (const status of nc.status()) {
		const { type, ...rest } = status;
		logger.debug(`[nats] ${connectionName}: ${type}`, "NATS", rest);
	}
}
