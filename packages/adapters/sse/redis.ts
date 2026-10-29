import type { EventEmitter } from "node:events";
import { logger } from "@fluxify/common";
import { Cluster, type ClusterNode, type ClusterOptions, type Redis } from "ioredis";
import { createRedisClient, type RedisVariantConfig } from "../kv/redis";
import type { Wire } from "./broker";

/**
 * Redis pub/sub. The subscriber is its own connection: one that ran SUBSCRIBE
 * can no longer run commands, so it can never be the shared KV client.
 *
 * On a Redis Cluster, classic PUBLISH is broadcast to every shard, which brings
 * the fanout back. There the wire uses sharded pub/sub (SPUBLISH / SSUBSCRIBE,
 * Redis 7+), which only touches the shard that owns the channel.
 */
/** A down broker emits an error per reconnect attempt; ioredis would print each as unhandled. */
function quiet<T extends Redis | Cluster>(client: T): T {
	(client as EventEmitter).on("error", (error: Error) =>
		logger.warn(`[sse] redis broker: ${error.message}`, "SSE.redis"),
	);
	return client;
}

export class RedisWire implements Wire {
	private publisher?: Redis | Cluster;
	private clustered?: Promise<boolean>;

	constructor(private readonly config: RedisVariantConfig) {}

	/** Asks the server itself, so the integration needs no "cluster" switch. Cached once answered. */
	private isCluster() {
		if (!this.clustered) {
			const asking = this.detect();
			this.clustered = asking;
			// an unreachable broker is no answer: the next call asks again
			asking.catch(() => {
				if (this.clustered === asking) this.clustered = undefined;
			});
		}
		return this.clustered;
	}

	private async detect() {
		const probe = createRedisClient(this.config, {
			maxRetriesPerRequest: 0,
			retryStrategy: () => null,
		});
		// the failure reaches the caller through the rejected INFO; the event would only be a second report
		probe.on("error", () => undefined);
		try {
			return /cluster_enabled:1/.test(await probe.info("cluster"));
		} catch (error) {
			// a server that refuses INFO answers; only a dead connection is no answer
			if ((error as Error).name === "ReplyError") return false;
			throw error;
		} finally {
			probe.disconnect();
		}
	}

	async publish(subject: string, message: string) {
		const clustered = await this.isCluster();
		this.publisher ??= quiet(
			clustered ? clusterClient(this.config) : createRedisClient(this.config),
		);
		if (clustered) await (this.publisher as Cluster).spublish(subject, message);
		else await this.publisher.publish(subject, message);
	}

	async connect(onMessage: (subject: string, message: string) => void) {
		const clustered = await this.isCluster();
		const client = quiet(
			clustered
				? clusterClient(this.config, { shardedSubscribers: true })
				: createRedisClient(this.config),
		);
		(client as EventEmitter).on(clustered ? "smessage" : "message", onMessage);
		return {
			async add(subject: string) {
				await (clustered ? client.ssubscribe(subject) : client.subscribe(subject));
			},
			async remove(subject: string) {
				await (clustered ? client.sunsubscribe(subject) : client.unsubscribe(subject));
			},
			async close() {
				client.disconnect();
			},
		};
	}

	async close() {
		const publisher = this.publisher;
		this.publisher = undefined;
		publisher?.disconnect();
	}
}

/** A cluster client from the integration's host or url; the database index does not exist on a cluster. */
function clusterClient(config: RedisVariantConfig, extra: ClusterOptions = {}) {
	const url = config.source === "url" && config.url ? new URL(config.url) : undefined;
	const node: ClusterNode = url
		? { host: url.hostname, port: Number(url.port) || 6379 }
		: { host: String(config.host), port: Number(config.port) };
	const username = url ? decodeURIComponent(url.username) : config.username;
	const password = url ? decodeURIComponent(url.password) : config.password;
	return new Cluster([node], {
		...extra,
		redisOptions: {
			connectTimeout: 5000,
			...(username ? { username } : {}),
			...(password ? { password } : {}),
			...(url?.protocol === "rediss:" ? { tls: {} } : {}),
		},
	});
}
