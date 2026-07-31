import z from "zod";
import { db } from "../db";
import { CHAN_ON_APPCONFIG_CHANGE, subscribeToChannel } from "../db/redis";
import { appConfigEntity } from "../db/schema";
import { EncryptionService } from "../lib/encryption";
import { logger } from "@fluxify/common";

let appConfigCache: Record<
	string,
	Record<string, string | number | boolean>
> = {};

export async function loadAppConfig() {
	const configData = await loadConfigFromDB();
	subscribeToChannel(CHAN_ON_APPCONFIG_CHANGE, async () => {
		appConfigCache = await loadConfigFromDB();
		logger.info("appconfig reloaded");
	});
	appConfigCache = configData;
}

async function loadConfigFromDB() {
	const configData = await db
		.select({
			key: appConfigEntity.keyName,
			value: appConfigEntity.value,
			isEncrypted: appConfigEntity.isEncrypted,
			projectId: appConfigEntity.projectId,
			encodingType: appConfigEntity.encodingType,
			dataType: appConfigEntity.dataType,
		})
		.from(appConfigEntity);
	const config: typeof appConfigCache = {};
	for (let cfg of configData) {
		let value = cfg.value;
		value = EncryptionService.decodeData(value!, cfg.encodingType!);
		if (cfg.isEncrypted) {
			value = EncryptionService.decrypt(value!);
		}
		const key = cfg.key!;
		const projectId = cfg.projectId;
		if (!config[projectId!]) {
			config[projectId!] = {};
		}
		switch (cfg.dataType) {
			case "string":
				config[projectId!][key] = value;
				break;
			case "boolean":
				config[projectId!][key] = z.boolean().safeParse(value).data || value;
				break;
			case "number":
				config[projectId!][key] = z.number().safeParse(value).data || value;
				break;
		}
	}
	return config;
}

/**
 * Fill the cache from an artifact instead of the database — the compiled worker
 * has no database connection, so its config arrives already decrypted over KV.
 */
export function hydrateAppConfig(
	projectId: string,
	config: Record<string, string | number | boolean>,
) {
	appConfigCache[projectId] = config;
}

export function getProjectAppConfig(projectId: string) {
	return appConfigCache[projectId];
}

export function getAppConfig(projectId: string, key: string) {
	return appConfigCache[projectId]?.[key];
}
