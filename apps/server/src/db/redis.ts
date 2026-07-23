import { logger } from "@fluxify/common";
import EventEmitter from "events";
import { Redis } from "ioredis";

let redisClient: Redis = null!;
let publisherClient: Redis = null!;
let subscriberClient: Redis = null!;

export const CHAN_ON_ROUTE_CHANGE = "chan:on-route-change";
export const CHAN_ON_APPCONFIG_CHANGE = "chan:on-appconfig-change";
export const CHAN_ON_INTEGRATION_CHANGE = "chan:on-integration-change";
export const CHAN_AI_WORKER = "chan:ai-worker";
export const CHAN_AI_SSE_PREFIX = "chan:ai-sse:";
export const CHAN_ON_PROJECT_SETTING_CHANGE = "chan:on-project-setting-change";
export const CHAN_ON_CUSTOM_BLOCK_CHANGE = "chan:on-custom-block-change";
export const CHAN_ON_INSTANCE_SETTING_CHANGE = "chan:on-instance-setting-change";

export function initializeRedis(hotReload?: boolean) {
	const canHotreload = hotReload || process.env.HOT_RELOAD_ROUTES == "true";

	redisClient = createRedisClient();
	redisClient.connect(() => {
		logger.info("[Redis] connected");
	});

	if (canHotreload) {
		subscriberClient = createRedisClient();
		subscriberClient.subscribe(
			CHAN_ON_ROUTE_CHANGE,
			CHAN_ON_APPCONFIG_CHANGE,
			CHAN_ON_INTEGRATION_CHANGE,
			CHAN_ON_CUSTOM_BLOCK_CHANGE,
			CHAN_ON_INSTANCE_SETTING_CHANGE,
		);
	}
}

export async function publishMessage(chan: string, data: string | object) {
	if (publisherClient == null) {
		publisherClient = createRedisClient();
	}
	data = typeof data === "object" ? JSON.stringify(data) : data;
	await publisherClient.publish(chan, data);
}

export async function subscribeToChannel(
	chan: string,
	callback: (data: string) => void,
) {
	await subscriberClient.subscribe(chan);
	const listener = (channel: string, data: string) => {
		if (chan !== channel) return;
		callback(data);
	};
	subscriberClient.on("message", listener);

	return async () => {
		subscriberClient.off("message", listener);
		await subscriberClient.unsubscribe(chan);
	};
}

function createRedisClient() {
	return new Redis({
		host: process.env.REDIS_HOST!,
		port: Number(process.env.REDIS_PORT!),
		username: process.env.REDIS_USER!,
		password: process.env.REDIS_PASS!,
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
