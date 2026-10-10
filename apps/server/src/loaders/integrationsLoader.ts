import {
	AnthropicIntegration,
	DbFactory,
	GeminiIntegration,
	LokiLogger,
	MemcachedIntegration,
	MistralIntegration,
	OpenAICompatibleIntegration,
	OpenAIIntegration,
	OpenTelemetryLogs,
	RedisIntegration,
} from "@fluxify/adapters";
import { logger, MissingEnvValueError } from "@fluxify/common";
import {
	aiVariantSchema,
	databaseVariantSchema,
	integrationsGroupSchema,
	kvVariantSchema,
	normalizeObservabilityVariant,
	observabilityVariantSchema,
} from "../api/v1/integrations/schemas";
import { db } from "../db";
import {
	CHAN_ON_APPCONFIG_CHANGE,
	CHAN_ON_INTEGRATION_CHANGE,
	subscribeToChannel,
} from "../db/redis";
import { integrationsEntity } from "../db/schema";
import type { FluxifyEnv } from "../lib/env";
import { pickValue } from "../lib/envValues";
import { parseMongoUrl } from "../lib/parsers/mongodb";
import { parseMysqlUrl } from "../lib/parsers/mysql";
import { parsePostgresUrl } from "../lib/parsers/postgres";
import { getProjectAppConfig } from "./appconfigLoader";

export let dbIntegrationsCache: Record<string, any> = {};
export let kvIntegrationsCache: Record<string, any> = {};
export let observabilityIntegrationsCache: Record<string, any> = {};
export let aiIntegrationsCache: Record<string, any> = {};
export let queueIntegrationsCache: Record<string, any> = {};

/**
 * Every cached config carries the id of the project that owns it. Nothing else
 * in the cache records ownership — the key is the integration id — so without
 * this any code holding the cache can hand one project's credentials to
 * another. Prefixed to keep it clear of the connection fields adapters read.
 */
export const OWNER_KEY = "__projectId";

/** null owner = not project-scoped, usable by everyone */
export function ownsIntegration(config: any, projectId: string) {
	const owner = config?.[OWNER_KEY];
	return !!config && (owner == null || owner === projectId);
}

/**
 * The cached config for an integration id, whichever group it belongs to.
 *
 * An id alone does not say which cache holds it, so any ownership check written
 * against one or two of the four silently passes every id in the others.
 */
export function findIntegrationConfig(id: string) {
	return (
		dbIntegrationsCache[id] ??
		kvIntegrationsCache[id] ??
		observabilityIntegrationsCache[id] ??
		aiIntegrationsCache[id] ??
		queueIntegrationsCache[id]
	);
}

/** only the entries `projectId` is allowed to see */
export function scopeToProject<T>(cache: Record<string, T>, projectId: string): Record<string, T> {
	const scoped: Record<string, T> = {};
	for (const id in cache) {
		if (ownsIntegration(cache[id], projectId)) scoped[id] = cache[id]!;
	}
	return scoped;
}

/**
 * Integrations this environment has no value for (#733), by id, with the
 * reason. Only a development worker has any: the compiler leaves them out of the
 * caches and names them here instead.
 */
const missingValues = new Map<string, { projectId: string; message: string }>();

/**
 * A cache whose lookup of a missing integration throws the reason. One place
 * covers every reader — each factory, the trigger runtime, telemetry — where a
 * check in each would miss the next one added. Only the `get` is trapped: the
 * missing ids are not keys, so iteration, `in` and spreading see what is there.
 */
function guarded(cache: Record<string, any>) {
	const proxy = new Proxy(cache, {
		get(target, id, receiver) {
			const missing = typeof id === "string" ? missingValues.get(id) : undefined;
			if (missing) throw new MissingEnvValueError(missing.message);
			return Reflect.get(target, id, receiver);
		},
	});
	targets.set(proxy, cache);
	return proxy;
}

const targets = new WeakMap<object, Record<string, any>>();

/**
 * The cache without the guard, for code that walks it by the ids of things it
 * already holds (closing a connection whose integration is gone): that is a
 * lookup of a stale id, not a use, and must not throw.
 */
export function unguarded(cache: Record<string, any>) {
	return targets.get(cache) ?? cache;
}

/**
 * Fill the caches from an artifact instead of the database. Configs are already
 * resolved when the compiler publishes them (cfg: references expanded, urls
 * parsed), so there is nothing left to look up. `missing` maps an integration
 * id to why this environment cannot use it.
 *
 * Merged per project rather than replaced: a worker running with
 * WORKER_PROJECT_ID=* holds several projects at once, and each project's config
 * artifact arrives as its own update.
 */
export function hydrateIntegrations(
	projectId: string,
	caches: {
		db?: Record<string, any>;
		kv?: Record<string, any>;
		observability?: Record<string, any>;
		ai?: Record<string, any>;
		queue?: Record<string, any>;
	},
	missing: Record<string, string> = {},
) {
	for (const [id, entry] of missingValues) {
		if (entry.projectId === projectId) missingValues.delete(id);
	}
	for (const id in missing) missingValues.set(id, { projectId, message: missing[id]! });

	if (caches.db) dbIntegrationsCache = guarded(merge(dbIntegrationsCache, caches.db, projectId));
	if (caches.kv) kvIntegrationsCache = guarded(merge(kvIntegrationsCache, caches.kv, projectId));
	if (caches.observability)
		observabilityIntegrationsCache = guarded(
			merge(observabilityIntegrationsCache, caches.observability, projectId),
		);
	if (caches.ai) aiIntegrationsCache = guarded(merge(aiIntegrationsCache, caches.ai, projectId));
	if (caches.queue)
		queueIntegrationsCache = guarded(merge(queueIntegrationsCache, caches.queue, projectId));
}

/** drop what this project used to own, then take what it owns now */
function merge(current: Record<string, any>, incoming: Record<string, any>, projectId: string) {
	const next: Record<string, any> = {};
	// an entry from before this publish may be one it now names as missing
	const held = unguarded(current);
	for (const id in held) {
		if (held[id]?.[OWNER_KEY] !== projectId) next[id] = held[id];
	}
	return Object.assign(next, incoming);
}

export async function loadIntegrations() {
	await loadFromDB();
	subscribeToChannel(CHAN_ON_INTEGRATION_CHANGE, async () => {
		logger.info("integrations reloaded");
		await loadFromDB();
		await DbFactory.ResetConnections();
	});
	subscribeToChannel(CHAN_ON_APPCONFIG_CHANGE, async () => {
		logger.info("integrations reloaded");
		await loadFromDB();
		await DbFactory.ResetConnections();
	});
}

export type IntegrationRow = {
	id: string;
	group: string | null;
	variant: string | null;
	config: unknown;
	devConfig?: unknown;
	syncDev?: boolean | null;
	projectId: string | null;
};

/**
 * The config `env` runs on, or null when development has none (#733). Dev
 * reads its own unless `syncDev`; production always reads `config`.
 */
export function configForEnv(integration: IntegrationRow, env: FluxifyEnv) {
	return pickValue(env, integration.syncDev ?? false, integration.config, integration.devConfig);
}

/** the cache a group's resolved config belongs in, or undefined for an unknown group */
export function cacheForGroup(group: string | null) {
	switch (group) {
		case integrationsGroupSchema.enum.database:
			return dbIntegrationsCache;
		case integrationsGroupSchema.enum.observability:
			return observabilityIntegrationsCache;
		case integrationsGroupSchema.enum.kv:
			return kvIntegrationsCache;
		case integrationsGroupSchema.enum.ai:
			return aiIntegrationsCache;
		case integrationsGroupSchema.enum.queue:
			return queueIntegrationsCache;
		default:
			return undefined;
	}
}

/**
 * One row -> the connection config the runtime caches, with `cfg:` references
 * expanded from `appConfig`.
 *
 * `appConfig` is a parameter, not a cache read, so a caller holding overridden
 * values (the test runner) resolves against those instead of the live ones.
 * `env` picks which of the row's two configs is read; it is always the
 * environment's own app config that `appConfig` must come from.
 */
export function resolveIntegrationConfig(
	integration: IntegrationRow,
	appConfig: Record<string, any> | undefined,
	env: FluxifyEnv,
): any {
	const group = integration.group!;
	const variant = integration.variant!;
	const raw = configForEnv(integration, env) as any;
	let config: any = null!;
	if (!raw) return config;

	if (group === integrationsGroupSchema.enum.database) {
		if (variant === databaseVariantSchema.enum.PostgreSQL) {
			config = mapIntegrationToConnectionData(appConfig, raw, parsePostgresUrl);
		} else if (variant === databaseVariantSchema.enum.MySQL) {
			config = mapIntegrationToConnectionData(appConfig, raw, parseMysqlUrl);
		} else if (variant === databaseVariantSchema.enum.MongoDB) {
			config = mapIntegrationToConnectionData(appConfig, raw, parseMongoUrl);
		}
	} else if (group === integrationsGroupSchema.enum.observability) {
		// normalized so rows still carrying the old "Open Telemetry Logs" name
		// resolve to the same adapter
		const observabilityVariant = normalizeObservabilityVariant(variant);
		if (observabilityVariant === observabilityVariantSchema.enum["Open Telemetry"]) {
			config = OpenTelemetryLogs.ExtractConnectionInfo(raw, appConfig!);
		} else if (observabilityVariant === observabilityVariantSchema.enum["Loki"]) {
			config = LokiLogger.extractConnectionInfo(raw, appConfig!);
		}
	} else if (group === integrationsGroupSchema.enum.kv) {
		const appConfigMap = convertObjectToMap(appConfig);
		if (variant === kvVariantSchema.enum.Redis) {
			config = RedisIntegration.ExtractConnectionInfo(raw, appConfigMap);
		} else if (variant === kvVariantSchema.enum.Memcached) {
			config = MemcachedIntegration.ExtractConnectionInfo(raw, appConfigMap);
		}
	} else if (group === integrationsGroupSchema.enum.ai) {
		const appConfigMap = convertObjectToMap(appConfig);
		if (variant === aiVariantSchema.enum.Anthropic) {
			config = AnthropicIntegration.ExtractConnectionInfo(raw, appConfigMap);
		} else if (variant === aiVariantSchema.enum.Gemini) {
			config = GeminiIntegration.ExtractConnectionInfo(raw, appConfigMap);
		} else if (variant === aiVariantSchema.enum.OpenAI) {
			config = OpenAIIntegration.ExtractConnectionInfo(raw, appConfigMap);
		} else if (variant === aiVariantSchema.enum.Mistral) {
			config = MistralIntegration.ExtractConnectionInfo(raw, appConfigMap);
		} else if (variant === aiVariantSchema.enum["OpenAI Compatible"]) {
			config = OpenAICompatibleIntegration.ExtractConnectionInfo(raw, appConfigMap);
		}
	} else if (group === integrationsGroupSchema.enum.queue) {
		// flat fields, each possibly a `cfg:` reference; there is no url form
		config = mapIntegrationToConnectionData(appConfig, raw, () => null);
	}

	if (config) {
		// the cached variant is what IntegrationFactory switches on, so it has to
		// be the current name even when the row still stores the old one
		config["variant"] =
			group === integrationsGroupSchema.enum.observability
				? normalizeObservabilityVariant(variant)
				: variant;
		config["group"] = group;
		config[OWNER_KEY] = integration.projectId ?? null;
		if (group === integrationsGroupSchema.enum.database) {
			if (variant === databaseVariantSchema.enum.PostgreSQL) {
				config["dbType"] = "pg";
			} else if (variant === databaseVariantSchema.enum.MySQL) {
				config["dbType"] = "mysql";
			} else if (variant === databaseVariantSchema.enum.MongoDB) {
				config["dbType"] = "mongo";
			}
			// a url-sourced row maps to its parsed url, which carries neither
			if (raw.queryTimeoutMs) config["queryTimeoutMs"] = raw.queryTimeoutMs;
			if (raw.maxConnections) config["maxConnections"] = raw.maxConnections;
		}
	}
	return config;
}

async function loadFromDB() {
	const integrations = await db.select().from(integrationsEntity);
	for (const integration of integrations) {
		const cache = cacheForGroup(integration.group);
		if (!cache) continue;
		// this loader backs the production, database-connected process
		cache[integration.id] = resolveIntegrationConfig(
			integration,
			getProjectAppConfig(integration.projectId!),
			"production",
		);
	}
}

function convertObjectToMap(config: Record<string, any> | undefined) {
	const map = new Map<string, string>();
	for (const key in config) {
		map.set(key, config[key]);
	}
	return map;
}

/** `cfg:KEY` -> the app config value, anything else unchanged */
function expand(appConfig: Record<string, any> | undefined, value: unknown) {
	const text = value?.toString() ?? "";
	return text.startsWith("cfg:") ? appConfig?.[text.slice(4)] : value;
}

/**
 * A database row -> connection details, `cfg:` references expanded.
 *
 * The expansion goes into a NEW object and is never written back onto `config`.
 * The test runner resolves the same row twice — once against the live app
 * config, once against the overridden one — and a row whose `cfg:` reference had
 * been overwritten by the first pass would silently keep the first pass's value.
 */
function mapIntegrationToConnectionData(
	appConfig: Record<string, any> | undefined,
	config: Record<string, string>,
	parseUrl: (url: string) => any,
) {
	const connectionDetails = {} as any;
	if (config.source === "url") {
		// missing cfg key -> "" -> no match -> logged, rather than a TypeError
		const parsed = parseUrl(String(expand(appConfig, config.url) ?? ""));
		if (parsed) return parsed;
		logger.info("Failed to load integration");
		return connectionDetails;
	}
	for (const key in config) {
		connectionDetails[key] = expand(appConfig, config[key]);
	}
	return connectionDetails;
}
