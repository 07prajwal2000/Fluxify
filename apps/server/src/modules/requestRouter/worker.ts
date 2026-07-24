import { HttpRouteParser } from "@fluxify/lib";
import { logger } from "@fluxify/common";
import { drizzleInit } from "../../db";
import { initializeRedis } from "../../db/redis";
import { loadAppConfig } from "../../loaders/appconfigLoader";
import { loadIntegrations } from "../../loaders/integrationsLoader";
import { loadProjectSettings } from "../../loaders/projectSettingsLoader";
import {
	initializeCustomBlocksSubscription,
	loadCustomBlocks,
} from "../../loaders/customBlocksLoader";
import { loadRoutes } from "../../loaders/routesLoader";

/**
 * Boots everything the request worker needs to execute routes, independent of
 * transport. Returns the route parser that dispatch() matches envelopes
 * against. No admin/auth/seed — the worker is a pure execution node so k8s can
 * scale it separately from the admin API.
 *
 * ponytail: this is the data-loading half of server.ts main() duplicated;
 * extract a shared bootstrap once the ingestion gateway needs it too.
 */
export async function initWorker(): Promise<HttpRouteParser> {
	await drizzleInit(false); // worker never migrates; admin server owns migrations
	await initializeRedis();
	await loadAppConfig();
	await loadIntegrations();
	await loadProjectSettings();
	await loadCustomBlocks();
	initializeCustomBlocksSubscription();
	const parser = await loadRoutes();
	logger.info("request worker runtime initialized");
	return parser;
}
