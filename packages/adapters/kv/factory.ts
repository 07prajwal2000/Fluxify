import { createHash } from "node:crypto";
import type { BaseKVIntegration } from "./base";
import { MemcachedIntegration } from "./memcached";
import { RedisIntegration } from "./redis";

/** The resolved config the loader caches for a `kv` integration. */
export type KvConnectionConfig = {
	variant?: string;
	host?: string;
	port?: string | number;
	username?: string;
	password?: string;
	database?: string | number;
	source: "credentials" | "url";
	url?: string;
};

type KvClient = BaseKVIntegration & { disconnect(): Promise<void> };

type Entry = { fingerprint: string; client: KvClient };

/**
 * Hashes only what decides where a client connects; the raw secret is never
 * retained or logged. Mirrors `connectionFingerprint` for databases.
 */
export function kvConnectionFingerprint(config: KvConnectionConfig) {
	const material = JSON.stringify({
		variant: config.variant,
		source: config.source,
		url: config.url,
		host: config.host,
		port: String(config.port),
		username: config.username,
		password: config.password,
		database: config.database,
	});
	return createHash("sha256").update(material).digest("hex");
}

/**
 * Resolves `kv` integrations to their adapter, reusing one client per
 * integration across requests.
 *
 * Deliberately simpler than `DbConnectionManager`: a Redis client is a single
 * long-lived multiplexing connection with its own reconnect logic, not a pool a
 * request borrows from. Leasing it per request buys nothing, and closing it
 * when idle would make some later request pay a TCP+AUTH handshake to run a
 * sub-millisecond command — the one cost a cache exists to avoid.
 *
 * ponytail: clients live until their config changes or the process exits, so an
 * idle KV integration holds one socket open. Move to the lease/drain/idle-close
 * shape of `DbConnectionManager` if a worker ever hosts many mostly-idle KV
 * integrations.
 */
export class KvFactory {
	private static readonly clients = new Map<string, Entry>();

	constructor(private readonly kvConfig: Record<string, KvConnectionConfig>) {}

	public getKvAdapter(connection: string): BaseKVIntegration {
		const config = this.kvConfig[connection];
		if (!config) {
			throw new Error("config is null while creating kv adapter");
		}

		const fingerprint = kvConnectionFingerprint(config);
		const existing = KvFactory.clients.get(connection);
		if (existing && existing.fingerprint === fingerprint) return existing.client;
		// changed credentials: the old socket has to be closed, not just dropped,
		// or it stays open with nothing left able to reach it
		if (existing) void KvFactory.evict(connection);

		const client = KvFactory.create(config);
		KvFactory.clients.set(connection, { fingerprint, client });
		return client;
	}

	private static create(config: KvConnectionConfig): KvClient {
		if (config.variant === RedisIntegration.variant) {
			return new RedisIntegration(config);
		}
		if (config.variant === MemcachedIntegration.variant) {
			return new MemcachedIntegration(config);
		}
		throw new Error(`${config.variant} Not implemented`);
	}

	/**
	 * Applies a complete integration snapshot: a client whose config changed, or
	 * whose integration is gone, is closed and dropped so the next request builds
	 * it again from the new credentials.
	 */
	public static synchronize(configurations: Record<string, KvConnectionConfig>) {
		for (const [connection, entry] of KvFactory.clients) {
			const config = configurations[connection];
			if (!config) {
				void KvFactory.evict(connection);
				continue;
			}
			if (entry.fingerprint !== kvConnectionFingerprint(config)) {
				void KvFactory.evict(connection);
			}
		}
	}

	/** Closes every client. For shutdown and for tests. */
	public static async ResetConnections() {
		await Promise.all(
			[...KvFactory.clients.keys()].map((connection) => KvFactory.evict(connection)),
		);
	}

	private static async evict(connection: string) {
		const entry = KvFactory.clients.get(connection);
		if (!entry) return;
		// dropped first: a failing disconnect must not leave a dead client cached
		KvFactory.clients.delete(connection);
		try {
			await entry.client.disconnect();
		} catch {
			// a client that will not close cleanly is still gone from the map
		}
	}
}
