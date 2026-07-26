import { HttpRouteParser } from "@fluxify/lib";
import { logger } from "@fluxify/common";
import { drizzleInit, db } from "../../db";
import { appConfigEntity } from "../../db/schema";
import { initializeRedis } from "../../db/redis";
import { initializePubSub } from "../../db/pubsub";
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
/**
 * The admin server owns migrations, so a freshly started stack may not have the
 * schema yet when the worker boots. Poll until the core table exists instead of
 * letting the first loader throw and kill the process. Only "relation does not
 * exist" is retried — real errors (bad credentials, unreachable host) surface
 * immediately.
 */
async function waitForSchema(maxAttempts = 60, delayMs = 2000): Promise<void> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			await db.select().from(appConfigEntity).limit(1);
			return;
		} catch (e) {
			const msg = String((e as any)?.message ?? e);
			const missingSchema = msg.includes("42P01") || /does not exist/i.test(msg);
			if (!missingSchema) throw e;
			logger.warn(
				`waiting for database schema (attempt ${attempt}/${maxAttempts}) — is the admin server running migrations?`,
			);
			await Bun.sleep(delayMs);
		}
	}
	throw new Error("database schema not ready after waiting for migrations");
}

export async function initWorker(): Promise<HttpRouteParser> {
	await drizzleInit(false); // worker never migrates; admin server owns migrations
	initializeRedis();
	await initializePubSub();
	await waitForSchema();
	await loadAppConfig();
	await loadIntegrations();
	await loadProjectSettings();
	await loadCustomBlocks();
	initializeCustomBlocksSubscription();
	const parser = await loadRoutes();
	logger.info("request worker runtime initialized");
	return parser;
}
