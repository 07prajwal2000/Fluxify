import { logger, MissingEnvValueError } from "@fluxify/common";
import { eq } from "drizzle-orm";
import z from "zod";
import { db } from "../db";
import { CHAN_ON_APPCONFIG_CHANGE, subscribeToChannel } from "../db/redis";
import { appConfigEntity } from "../db/schema";
import { EncryptionService } from "../lib/encryption";
import type { FluxifyEnv } from "../lib/env";
import { missingAppConfigMessage, pickValue } from "../lib/envValues";

type AppConfigValues = Record<string, string | number | boolean>;

let appConfigCache: Record<string, AppConfigValues> = {};
/**
 * Keys this process's environment has no value for (#733), by project. Only a
 * development worker ever has any. Reading one throws, so a route that needs it
 * fails loudly instead of running on `undefined`.
 */
const missingKeys: Record<string, Set<string>> = {};

export async function loadAppConfig() {
	// the database-backed process is the production one; the values a
	// development worker runs on arrive in its project config artifact
	const configData = await loadAppConfigFor("production");
	subscribeToChannel(CHAN_ON_APPCONFIG_CHANGE, async () => {
		appConfigCache = (await loadAppConfigFor("production")).config;
		logger.info("appconfig reloaded");
	});
	appConfigCache = configData.config;
}

/**
 * Every project's app config as `env` sees it, read from the database. Admin
 * code names the environment: the process's own `FLUXIFY_ENV` says nothing
 * about which one it is publishing.
 */
export async function loadAppConfigFor(env: FluxifyEnv, projectId?: string) {
	const query = db
		.select({
			key: appConfigEntity.keyName,
			value: appConfigEntity.value,
			devValue: appConfigEntity.devValue,
			syncDev: appConfigEntity.syncDev,
			isEncrypted: appConfigEntity.isEncrypted,
			projectId: appConfigEntity.projectId,
			encodingType: appConfigEntity.encodingType,
			dataType: appConfigEntity.dataType,
		})
		.from(appConfigEntity);
	const configData = await (projectId
		? query.where(eq(appConfigEntity.projectId, projectId))
		: query);
	const config: Record<string, AppConfigValues> = {};
	const missing: Record<string, string[]> = {};
	for (const cfg of configData) {
		const key = cfg.key!;
		const owner = cfg.projectId!;
		const stored = pickValue(env, cfg.syncDev, cfg.value, cfg.devValue);
		if (stored === null) {
			missing[owner] = [...(missing[owner] ?? []), key];
			continue;
		}
		let value = EncryptionService.decodeData(stored, cfg.encodingType!);
		if (cfg.isEncrypted) {
			value = EncryptionService.decrypt(value!);
		}
		if (!config[owner]) {
			config[owner] = {};
		}
		switch (cfg.dataType) {
			case "string":
				config[owner][key] = value;
				break;
			case "boolean":
				config[owner][key] = z.boolean().safeParse(value).data || value;
				break;
			case "number":
				config[owner][key] = z.number().safeParse(value).data || value;
				break;
		}
	}
	return { config, missing };
}

/**
 * Fill the cache from an artifact instead of the database — the compiled worker
 * has no database connection, so its config arrives already decrypted over KV.
 * `missing` is the keys this environment has no value for.
 */
export function hydrateAppConfig(
	projectId: string,
	config: AppConfigValues,
	missing: string[] = [],
) {
	appConfigCache[projectId] = config;
	missingKeys[projectId] = new Set(missing);
}

export function getProjectAppConfig(projectId: string) {
	return appConfigCache[projectId];
}

export function getAppConfig(projectId: string, key: string) {
	if (missingKeys[projectId]?.has(key))
		throw new MissingEnvValueError(missingAppConfigMessage(key));
	return appConfigCache[projectId]?.[key];
}
