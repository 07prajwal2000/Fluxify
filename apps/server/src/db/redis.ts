import { logger } from "@fluxify/common";
import { Redis } from "ioredis";
import { getEnv } from "../lib/env";

// Pub/sub moved off Redis to NATS (ioredis subscriber-mode reconnect kept
// killing hot reload). Re-exported here so existing `db/redis` importers keep
// working; the real implementation lives in ./pubsub + ./nats.
export {
	CHAN_ON_ROUTE_CHANGE,
	CHAN_ON_APPCONFIG_CHANGE,
	CHAN_ON_INTEGRATION_CHANGE,
	CHAN_AI_WORKER,
	CHAN_AI_SSE_PREFIX,
	CHAN_ON_PROJECT_SETTING_CHANGE,
	CHAN_ON_CUSTOM_BLOCK_CHANGE,
	CHAN_ON_INSTANCE_SETTING_CHANGE,
	publishMessage,
	subscribeToChannel,
	initializePubSub,
} from "./pubsub";

let redisClient: Redis = null!;

// hotReload param kept for signature compat (hot reload now runs over NATS).
export function initializeRedis(_hotReload?: boolean) {
	redisClient = createRedisClient();
	redisClient.connect(() => {
		logger.info("[Redis] connected");
	});
}

function createRedisClient() {
	return new Redis({
		host: getEnv("REDIS_HOST")!,
		port: Number(getEnv("REDIS_PORT")!),
		username: getEnv("REDIS_USER")!,
		password: getEnv("REDIS_PASS")!,
		connectionName: crypto.randomUUID().substring(0, 6),
	});
}

export async function getCache(key: string): Promise<string> {
	const value = await redisClient.get(key);
	return value || "";
}

export async function setCacheEx(
	key: string,
	value: string,
	ttl: number = 120,
) {
	await redisClient.setex(key, ttl, value);
}
export async function hasCacheKey(key: string) {
	return redisClient.exists(key);
}
export async function deleteCacheKey(key: string) {
	return redisClient.del(key);
}
export async function setCache(key: string, value: string) {
	await redisClient.set(key, value);
}
export async function deleteCacheKeysByPattern(pattern: string) {
	const keys = await redisClient.keys(pattern);
	if (keys.length > 0) {
		await redisClient.del(...keys);
	}
}

/** Batched read: one round trip for N keys instead of N round trips. */
export async function mgetCache(keys: string[]): Promise<(string | null)[]> {
	if (keys.length === 0) return [];
	return redisClient.mget(...keys);
}

/** O(1) counter bump — use as a cache "generation" key to invalidate a whole
 *  family of cache keys without a KEYS scan (see deleteCacheKeysByPattern,
 *  which is O(N) over the full keyspace and blocks Redis while it runs). */
export async function incrCache(key: string): Promise<number> {
	return redisClient.incr(key);
}

/** Puts a TTL on an existing key — pair with `incrCache` to build a counter
 *  that expires (a rate-limit window), which `setCacheEx` can't do without
 *  overwriting the count. */
export async function expireCache(key: string, ttl: number): Promise<number> {
	return redisClient.expire(key, ttl);
}
