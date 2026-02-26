import { db } from "../db";
import { integrationsEntity } from "../db/schema";
import {
	CHAN_ON_APPCONFIG_CHANGE,
	CHAN_ON_INTEGRATION_CHANGE,
	subscribeToChannel,
} from "../db/redis";
import { appConfigCache } from "./appconfigLoader";
import { parsePostgresUrl } from "../lib/parsers/postgres";
import { parseMysqlUrl } from "../lib/parsers/mysql";
import { parseMongoUrl } from "../lib/parsers/mongodb";
import {
	integrationsGroupSchema,
	databaseVariantSchema,
	observabilityVariantSchema,
} from "../api/v1/integrations/schemas";
import { DbFactory, LokiLogger, OpenObserve } from "@fluxify/adapters";

export let dbIntegrationsCache: Record<string, any> = {};
export let kvIntegrationsCache: Record<string, any> = {};
export let observabilityIntegrationsCache: Record<string, any> = {};

export async function loadIntegrations() {
	await loadFromDB();
	subscribeToChannel(CHAN_ON_INTEGRATION_CHANGE, async () => {
		console.log("integrations reloaded");
		await loadFromDB();
		await DbFactory.ResetConnections();
	});
	subscribeToChannel(CHAN_ON_APPCONFIG_CHANGE, async () => {
		console.log("integrations reloaded");
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
				config = mapIntegrationToPgConnectionData(integration.config as any);
				dbIntegrationsCache[integration.id] = config;
			} else if (variant === databaseVariantSchema.enum.MySQL) {
				config = mapIntegrationToMysqlConnectionData(integration.config as any);
				dbIntegrationsCache[integration.id] = config;
			} else if (variant === databaseVariantSchema.enum.MongoDB) {
				config = mapIntegrationToMongoConnectionData(integration.config as any);
				dbIntegrationsCache[integration.id] = config;
			}
		} else if (
			integration.group === integrationsGroupSchema.enum.observability
		) {
			if (
				integration.variant === observabilityVariantSchema.enum["Open Observe"]
			) {
				config = OpenObserve.extractConnectionInfo(
					integration.config as any,
					appConfigCache,
				);
			} else if (
				integration.variant === observabilityVariantSchema.enum["Loki"]
			) {
				config = LokiLogger.extractConnectionInfo(
					integration.config as any,
					appConfigCache,
				);
			}
			observabilityIntegrationsCache[integration.id] = config;
		}
		if (config) {
			config["variant"] = variant;
			config["group"] = group;
		}
	}
}

function mapIntegrationToPgConnectionData(config: Record<string, string>) {
	let connectionDetails = {} as any;
	if (config.source === "url") {
		config.url = config.url.toString().startsWith("cfg:")
			? appConfigCache[config.url.slice(4)].toString()
			: config.url;
		const parsed = parsePostgresUrl(config.url);
		if (parsed) {
			connectionDetails = parsed;
		} else {
			console.log("Failed to load integration");
		}
	} else {
		for (let key in config) {
			const value = config[key];
			connectionDetails[key] = value.toString().startsWith("cfg:")
				? appConfigCache[value.slice(4)]
				: value;
		}
	}
	return connectionDetails;
}

function mapIntegrationToMysqlConnectionData(config: Record<string, string>) {
	let connectionDetails = {} as any;
	if (config.source === "url") {
		config.url = config.url.toString().startsWith("cfg:")
			? appConfigCache[config.url.slice(4)].toString()
			: config.url;
		const parsed = parseMysqlUrl(config.url);
		if (parsed) {
			connectionDetails = parsed;
		} else {
			console.log("Failed to load integration");
		}
	} else {
		for (let key in config) {
			const value = config[key];
			connectionDetails[key] = value.toString().startsWith("cfg:")
				? appConfigCache[value.slice(4)]
				: value;
		}
	}
	return connectionDetails;
}

function mapIntegrationToMongoConnectionData(config: Record<string, string>) {
	let connectionDetails = {} as any;
	if (config.source === "url") {
		config.url = config.url.toString().startsWith("cfg:")
			? appConfigCache[config.url.slice(4)].toString()
			: config.url;
		const parsed = parseMongoUrl(config.url);
		if (parsed) {
			connectionDetails = parsed;
		} else {
			console.log("Failed to load integration");
		}
	} else {
		for (let key in config) {
			const value = config[key];
			connectionDetails[key] = value.toString().startsWith("cfg:")
				? appConfigCache[value.slice(4)]
				: value;
		}
	}
	return connectionDetails;
}
