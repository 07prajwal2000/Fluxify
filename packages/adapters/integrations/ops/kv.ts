import type { IntegrationOpContext, IntegrationTestResult } from "@fluxify/sdk/integrations";
import { z } from "zod";
import { MemcachedIntegration } from "../../kv/memcached";
import { RedisIntegration } from "../../kv/redis";

/** longest value an inspect hands back, in characters */
export const KV_VALUE_CAP = 10_000;

const inspectRequest = z.object({ key: z.string().min(1, "key is required") });
type Request = z.infer<typeof inspectRequest>;

export type KvValueResult = {
	key: string;
	found: boolean;
	value: string | null;
	truncated: boolean;
	/** seconds left; null = no expiry, or unknown (see ttlNote) */
	ttlSeconds: number | null;
	ttlNote?: string;
};

function shape(key: string, value: string | null, ttlSeconds: number | null): KvValueResult {
	const truncated = (value?.length ?? 0) > KV_VALUE_CAP;
	return {
		key,
		found: value !== null,
		value: truncated ? value!.slice(0, KV_VALUE_CAP) : value,
		truncated,
		ttlSeconds: value === null ? null : ttlSeconds,
	};
}

const test =
	(
		adapter: {
			TestConnection(
				config: any,
				appConfigs: Map<string, string>,
			): Promise<{ success: boolean; error?: string }>;
		},
		name: string,
	) =>
	async (config: any, ctx: IntegrationOpContext): Promise<IntegrationTestResult> => {
		const result = await adapter.TestConnection(config, ctx.appConfig);
		return {
			success: result.success,
			error: result.error || (result.success ? "" : `Failed to connect to ${name}`),
		};
	};

export const KV_OPS = {
	"kv/Redis": {
		test: test(RedisIntegration, "Redis"),
		/** the value and its TTL; read only */
		async inspect(config: any, { key }: Request, ctx: IntegrationOpContext) {
			const kv = new RedisIntegration(
				RedisIntegration.ExtractConnectionInfo(config, ctx.appConfig),
				true,
			);
			try {
				const redis = kv.getConnection();
				const [value, ttl] = await Promise.all([
					redis.get(key) as Promise<string | null>,
					redis.ttl(key) as Promise<number>,
				]);
				return shape(key, value, ttl >= 0 ? ttl : null);
			} finally {
				await kv.disconnect();
			}
		},
		inspectRequest,
	},
	"kv/Memcached": {
		test: test(MemcachedIntegration, "Memcached"),
		async inspect(config: any, { key }: Request, ctx: IntegrationOpContext) {
			const kv = new MemcachedIntegration(
				MemcachedIntegration.ExtractConnectionInfo(config, ctx.appConfig),
				true,
			);
			try {
				const value = await kv.get(key);
				return { ...shape(key, value, null), ttlNote: "Memcached does not report TTL; unknown" };
			} finally {
				await kv.disconnect();
			}
		},
		inspectRequest,
	},
};
