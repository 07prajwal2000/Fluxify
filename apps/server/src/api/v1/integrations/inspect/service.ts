import {
	describeConnection,
	MemcachedIntegration,
	RedisIntegration,
	type SchemaDetails,
} from "@fluxify/adapters";
import type { z } from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { getAppConfigKeysFromData } from "../create/service";
import { getIntegrationByID } from "../get-by-id/repository";
import { buildConnection } from "../get-metadata/service";
import { decodeAppConfig } from "../test-connection/service";
import type { kvResponseSchema, requestRouteSchema } from "./dto";

export const INSPECT_TIMEOUT_MS = 10_000;
export const KV_VALUE_CAP = 10_000;

type Params = z.infer<typeof requestRouteSchema>;

async function load(params: Params, group: string) {
	const integration = await getIntegrationByID(params.projectId, params.integrationId);
	if (!integration) throw new NotFoundError("Integration not found");
	if (integration.group !== group) {
		throw new BadRequestError(`Not supported for ${integration.group} integrations`);
	}
	const appConfigs = await decodeAppConfig(
		getAppConfigKeysFromData(integration.config),
		params.projectId,
	);
	return { integration, appConfigs };
}

/** Rejects with a readable 400 on failure or after INSPECT_TIMEOUT_MS. */
async function readable<T>(what: string, work: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`timed out after ${INSPECT_TIMEOUT_MS / 1000} seconds`)),
			INSPECT_TIMEOUT_MS,
		);
	});
	try {
		return await Promise.race([work, timeout]);
	} catch (error) {
		throw new BadRequestError(`${what}: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		clearTimeout(timer);
	}
}

export async function getSchemaDetails(params: Params, tables?: string): Promise<SchemaDetails> {
	const { integration, appConfigs } = await load(params, "database");
	const connection = buildConnection(integration.variant!, integration.config, appConfigs);
	const names = tables
		?.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	return readable("Failed to read schema", describeConnection(connection, names));
}

export async function getKvValue(
	params: Params,
	key: string,
): Promise<z.infer<typeof kvResponseSchema>> {
	const { integration, appConfigs } = await load(params, "kv");
	const config = integration.config as any;
	if (integration.variant === "Redis") {
		const kv = new RedisIntegration(
			RedisIntegration.ExtractConnectionInfo(config, appConfigs),
			true,
		);
		try {
			const redis = kv.getConnection();
			const [value, ttl] = await readable(
				"Failed to read key",
				Promise.all([redis.get(key) as Promise<string | null>, redis.ttl(key) as Promise<number>]),
			);
			return shape(key, value, ttl >= 0 ? ttl : null);
		} finally {
			await kv.disconnect();
		}
	}
	if (integration.variant === "Memcached") {
		const kv = new MemcachedIntegration(
			MemcachedIntegration.ExtractConnectionInfo(config, appConfigs),
			true,
		);
		try {
			const value = await readable("Failed to read key", kv.get(key));
			return { ...shape(key, value, null), ttlNote: "Memcached does not report TTL; unknown" };
		} finally {
			await kv.disconnect();
		}
	}
	throw new BadRequestError(`Not supported for ${integration.variant}`);
}

function shape(key: string, value: string | null, ttlSeconds: number | null) {
	const truncated = (value?.length ?? 0) > KV_VALUE_CAP;
	return {
		key,
		found: value !== null,
		value: truncated ? value!.slice(0, KV_VALUE_CAP) : value,
		truncated,
		ttlSeconds: value === null ? null : ttlSeconds,
	};
}
