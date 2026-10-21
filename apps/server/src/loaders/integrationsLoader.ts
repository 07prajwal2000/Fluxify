import {
	appConfigMap,
	DbFactory,
	expandStoredConfig,
	integrationRegistry,
	resolveMcpHeaders,
} from "@fluxify/adapters";
import { MissingEnvValueError } from "@fluxify/common";
import { isIntegrationGroupName } from "@fluxify/sdk/integrations";
import { mcpOAuthFor } from "../api/v1/integrations/mcp-oauth/store";
import { integrationsGroupSchema } from "../api/v1/integrations/schemas";
import { db } from "../db";
import {
	CHAN_ON_APPCONFIG_CHANGE,
	CHAN_ON_INTEGRATION_CHANGE,
	subscribeToChannel,
} from "../db/redis";
import { integrationsEntity } from "../db/schema";
import type { FluxifyEnv } from "../lib/env";
import { pickValue } from "../lib/envValues";
import { getProjectAppConfig } from "./appconfigLoader";

export let dbIntegrationsCache: Record<string, any> = {};
export let kvIntegrationsCache: Record<string, any> = {};
export let observabilityIntegrationsCache: Record<string, any> = {};
export let aiIntegrationsCache: Record<string, any> = {};
export let queueIntegrationsCache: Record<string, any> = {};
/** integrations of a plugin's own groups (`acme/store`); only plugin blocks use them (I4) */
export let pluginIntegrationsCache: Record<string, any> = {};
/**
 * mcp integrations as { name, url, headers }, headers resolved; read by the agent (#821).
 * Signed in with OAuth (#824): `auth` is "oauth" and `oauth` is the stored connection,
 * undefined while nobody has connected. It holds the tokens in a closure, so logging or
 * serializing an entry shows none of them.
 */
export const mcpIntegrationsCache: Record<string, any> = {};

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
		queueIntegrationsCache[id] ??
		pluginIntegrationsCache[id] ??
		mcpIntegrationsCache[id]
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
		plugin?: Record<string, any>;
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
	if (caches.plugin)
		pluginIntegrationsCache = guarded(merge(pluginIntegrationsCache, caches.plugin, projectId));
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
		await loadFromDB();
		await DbFactory.ResetConnections();
	});
	subscribeToChannel(CHAN_ON_APPCONFIG_CHANGE, async () => {
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
	name?: string | null;
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
		case integrationsGroupSchema.enum.mcp:
			return mcpIntegrationsCache;
		default:
			return isIntegrationGroupName(group ?? "") ? pluginIntegrationsCache : undefined;
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
	const raw = configForEnv(integration, env) as any;
	if (!raw) return null;
	// an alias resolves too: a row still named "Open Telemetry Logs" is Open Telemetry
	const def = integrationRegistry.get(
		group,
		integration.variant!,
		integration.projectId ?? undefined,
	);
	if (!def) return null;

	const config =
		group === "mcp"
			? {
					name: integration.name,
					url: raw.url,
					headers: resolveMcpHeaders(raw.headers, appConfigMap(appConfig)),
					auth: raw.auth === "oauth" ? "oauth" : undefined,
					oauth: raw.auth === "oauth" ? mcpOAuthFor(integration, env) : undefined,
				}
			: // flat fields, each possibly a `cfg:` reference, unless the variant knows better
				def.resolve
				? def.resolve(raw, appConfig)
				: expandStoredConfig(appConfig, raw);

	if (config) {
		// the cached variant is what the factories look up, so it has to be the
		// current name even when the row still stores an alias
		config["variant"] = def.variant;
		config["group"] = group;
		config[OWNER_KEY] = integration.projectId ?? null;
		if (def.group === "database") {
			config["dbType"] = def.extras.dbType;
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
