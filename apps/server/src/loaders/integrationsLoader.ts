import { db } from "../db";
import { integrationsEntity } from "../db/schema";
import {
	CHAN_ON_APPCONFIG_CHANGE,
	CHAN_ON_INTEGRATION_CHANGE,
	subscribeToChannel,
} from "../db/redis";
import { getAppConfig, getProjectAppConfig } from "./appconfigLoader";
import { parsePostgresUrl } from "../lib/parsers/postgres";
import { parseMysqlUrl } from "../lib/parsers/mysql";
import { parseMongoUrl } from "../lib/parsers/mongodb";
import {
	integrationsGroupSchema,
	databaseVariantSchema,
	observabilityVariantSchema,
	normalizeObservabilityVariant,
	aiVariantSchema,
	kvVariantSchema,
} from "../api/v1/integrations/schemas";
import {
	AnthropicIntegration,
	DbFactory,
	GeminiIntegration,
	LokiLogger,
	MistralIntegration,
	OpenAICompatibleIntegration,
	OpenAIIntegration,
	OpenTelemetryLogs,
	RedisIntegration,
	MemcachedIntegration,
} from "@fluxify/adapters";
import { logger } from "@fluxify/common";

export let dbIntegrationsCache: Record<string, any> = {};
export let kvIntegrationsCache: Record<string, any> = {};
export let observabilityIntegrationsCache: Record<string, any> = {};
export let aiIntegrationsCache: Record<string, any> = {};

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

/** only the entries `projectId` is allowed to see */
export function scopeToProject<T>(
	cache: Record<string, T>,
	projectId: string,
): Record<string, T> {
	const scoped: Record<string, T> = {};
	for (const id in cache) {
		if (ownsIntegration(cache[id], projectId)) scoped[id] = cache[id]!;
	}
	return scoped;
}

/**
 * Fill the caches from an artifact instead of the database. Configs are already
 * resolved when the compiler publishes them (cfg: references expanded, urls
 * parsed), so there is nothing left to look up.
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
	},
) {
	if (caches.db) dbIntegrationsCache = merge(dbIntegrationsCache, caches.db, projectId);
	if (caches.kv) kvIntegrationsCache = merge(kvIntegrationsCache, caches.kv, projectId);
	if (caches.observability)
		observabilityIntegrationsCache = merge(
			observabilityIntegrationsCache,
			caches.observability,
			projectId,
		);
	if (caches.ai) aiIntegrationsCache = merge(aiIntegrationsCache, caches.ai, projectId);
}

/** drop what this project used to own, then take what it owns now */
function merge(
	current: Record<string, any>,
	incoming: Record<string, any>,
	projectId: string,
) {
	const next: Record<string, any> = {};
	for (const id in current) {
		if (current[id]?.[OWNER_KEY] !== projectId) next[id] = current[id];
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

async function loadFromDB() {
	const integrations = await db.select().from(integrationsEntity);
	for (let integration of integrations) {
		const group = integration.group!;
		const variant = integration.variant!;
		let config: any = null!;
		if (integration.group === integrationsGroupSchema.enum.database) {
			if (integration.variant === databaseVariantSchema.enum.PostgreSQL) {
				config = mapIntegrationToPgConnectionData(
					integration.projectId!,
					integration.config as any,
				);
			} else if (variant === databaseVariantSchema.enum.MySQL) {
				config = mapIntegrationToMysqlConnectionData(
					integration.projectId!,
					integration.config as any,
				);
			} else if (variant === databaseVariantSchema.enum.MongoDB) {
				config = mapIntegrationToMongoConnectionData(
					integration.projectId!,
					integration.config as any,
				);
			}
			dbIntegrationsCache[integration.id] = config;
		} else if (
			integration.group === integrationsGroupSchema.enum.observability
		) {
			// normalized so rows still carrying the old "Open Telemetry Logs" name
			// resolve to the same adapter
			const observabilityVariant = normalizeObservabilityVariant(variant);
			if (
				observabilityVariant === observabilityVariantSchema.enum["Open Telemetry"]
			) {
				config = OpenTelemetryLogs.ExtractConnectionInfo(
					integration.config as any,
					getProjectAppConfig(integration.projectId!),
				);
			} else if (
				observabilityVariant === observabilityVariantSchema.enum["Loki"]
			) {
				config = LokiLogger.extractConnectionInfo(
					integration.config as any,
					getProjectAppConfig(integration.projectId!),
				);
			}
			observabilityIntegrationsCache[integration.id] = config;
		} else if (integration.group === integrationsGroupSchema.enum.kv) {
			const appConfigMap = convertObjectToMap(
				getProjectAppConfig(integration.projectId!),
			);
			if (integration.variant === kvVariantSchema.enum.Redis) {
				config = RedisIntegration.ExtractConnectionInfo(
					integration.config as any,
					appConfigMap,
				);
			} else if (integration.variant === kvVariantSchema.enum.Memcached) {
				config = MemcachedIntegration.ExtractConnectionInfo(
					integration.config as any,
					appConfigMap,
				);
			}
			kvIntegrationsCache[integration.id] = config;
		} else if (integration.group === integrationsGroupSchema.enum.ai) {
			const appConfigMap = convertObjectToMap(
				getProjectAppConfig(integration.projectId!),
			);
			if (integration.variant === aiVariantSchema.enum.Anthropic) {
				config = AnthropicIntegration.ExtractConnectionInfo(
					integration.config as any,
					appConfigMap,
				);
			} else if (integration.variant === aiVariantSchema.enum.Gemini) {
				config = GeminiIntegration.ExtractConnectionInfo(
					integration.config as any,
					appConfigMap,
				);
			} else if (integration.variant === aiVariantSchema.enum.OpenAI) {
				config = OpenAIIntegration.ExtractConnectionInfo(
					integration.config as any,
					appConfigMap,
				);
			} else if (integration.variant === aiVariantSchema.enum.Mistral) {
				config = MistralIntegration.ExtractConnectionInfo(
					integration.config as any,
					appConfigMap,
				);
			} else if (
				integration.variant === aiVariantSchema.enum["OpenAI Compatible"]
			) {
				config = OpenAICompatibleIntegration.ExtractConnectionInfo(
					integration.config as any,
					appConfigMap,
				);
			}
			aiIntegrationsCache[integration.id] = config;
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
			}
		}
	}
}

function convertObjectToMap(config: Record<string, any>) {
	let map = new Map<string, string>();
	for (let key in config) {
		map.set(key, config[key]);
	}
	return map;
}

function mapIntegrationToPgConnectionData(
	projectId: string,
	config: Record<string, string>,
) {
	let connectionDetails = {} as any;
	if (config.source === "url") {
		config.url = config.url.toString().startsWith("cfg:")
			? (getAppConfig(projectId, config.url.slice(4)) as string)
			: config.url;
		const parsed = parsePostgresUrl(config.url);
		if (parsed) {
			connectionDetails = parsed;
		} else {
			logger.info("Failed to load integration");
		}
	} else {
		for (let key in config) {
			const value = config[key];
			connectionDetails[key] = value.toString().startsWith("cfg:")
				? getAppConfig(projectId, value.slice(4))
				: value;
		}
	}
	return connectionDetails;
}

function mapIntegrationToMysqlConnectionData(
	projectId: string,
	config: Record<string, string>,
) {
	let connectionDetails = {} as any;
	if (config.source === "url") {
		config.url = config.url.toString().startsWith("cfg:")
			? (getAppConfig(projectId, config.url.slice(4)) as string)
			: config.url;
		const parsed = parseMysqlUrl(config.url);
		if (parsed) {
			connectionDetails = parsed;
		} else {
			logger.info("Failed to load integration");
		}
	} else {
		for (let key in config) {
			const value = config[key];
			connectionDetails[key] = value.toString().startsWith("cfg:")
				? getAppConfig(projectId, value.slice(4))
				: value;
		}
	}
	return connectionDetails;
}

function mapIntegrationToMongoConnectionData(
	projectId: string,
	config: Record<string, string>,
) {
	let connectionDetails = {} as any;
	if (config.source === "url") {
		config.url = config.url.toString().startsWith("cfg:")
			? (getAppConfig(projectId, config.url.slice(4)) as string)
			: config.url;
		const parsed = parseMongoUrl(config.url);
		if (parsed) {
			connectionDetails = parsed;
		} else {
			logger.info("Failed to load integration");
		}
	} else {
		for (let key in config) {
			const value = config[key];
			connectionDetails[key] = value.toString().startsWith("cfg:")
				? getAppConfig(projectId, value.slice(4))
				: value;
		}
	}
	return connectionDetails;
}
