import { z } from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import {
	aiVariantSchema,
	databaseVariantSchema,
	integrationsGroupSchema,
	lokiVariantConfigSchema,
	observabilityVariantSchema,
	openTelemetryLogsVariantConfigSchema,
	postgresVariantConfigSchema,
	kvVariantSchema,
} from "../schemas";
import { getAppConfigKeysFromData } from "../create/service";
import { getAppConfigs } from "./repository";
import { parsePostgresUrl } from "../../../../lib/parsers/postgres";
import { parseMysqlUrl } from "../../../../lib/parsers/mysql";
import { parseMongoUrl } from "../../../../lib/parsers/mongodb";
import {
	AnthropicIntegration,
	extractPgConnectionInfo,
	GeminiIntegration,
	LokiLogger,
	MistralIntegration,
	OpenAICompatibleIntegration,
	OpenAIIntegration,
	OpenTelemetryLogs,
	PostgresAdapter,
	MySqlAdapter,
	MongoAdapter,
	extractMysqlConnectionInfo,
	extractMongoConnectionInfo,
	Connection,
	RedisIntegration,
	MemcachedIntegration,
} from "@fluxify/adapters";
import { EncryptionService } from "../../../../lib/encryption";
import { getSchema } from "../helpers";

export async function testIntegrationConnection(
	projectId: string,
	group: z.infer<typeof integrationsGroupSchema>,
	variant: string,
	config: any,
): Promise<z.infer<typeof responseSchema>> {
	const schema = getSchema(group, variant);
	if (!schema) {
		return {
			success: false,
			error: "Invalid group or variant",
		};
	}
	const result = schema.safeParse(config);

	if (!result.success) {
		return {
			success: false,
			error: "Invalid configuration",
		};
	}
	const integrationData = result.data;
	const keys = getAppConfigKeysFromData(integrationData);
	const appConfigs = await decodeAppConfig(keys, projectId);

	switch (group) {
		case "database":
			return testDatabasesConnection(variant, config, appConfigs);
		case "kv":
			return testKvConnection(variant, config, appConfigs);
		case "ai":
			return testAiConnection(variant, config, appConfigs);
		case "baas":
			break;
		case "observability":
			return testObservibilityConnection(variant, config, appConfigs);
		default:
			return {
				success: false,
				error: "Invalid group",
			};
	}
	return {
		success: false,
		error: "Unsupported group",
	};
}

export default async function handleRequest(
	projectId: string,
	body: z.infer<typeof requestBodySchema>,
): Promise<z.infer<typeof responseSchema>> {
	const { group, variant, config: data } = body;
	
	const timeoutPromise = new Promise<z.infer<typeof responseSchema>>((resolve) =>
		setTimeout(() => resolve({ success: false, error: "Connection timed out after 5 seconds" }), 5000)
	);

	const connectionPromise = testIntegrationConnection(projectId, group, variant, data);
	return Promise.race([connectionPromise, timeoutPromise]);
}

async function testDatabasesConnection(
	variant: string,
	config: any,
	appConfigs: Map<string, string>,
) {
	switch (variant as z.infer<typeof databaseVariantSchema>) {
		case "PostgreSQL":
			const pgConfig = extractPgConnectionInfo(
				config,
				appConfigs,
				parsePostgresUrl,
			);

			if (!pgConfig) {
				return {
					success: false,
					error: "Invalid configuration",
				};
			}
			pgConfig.ssl = pgConfig.ssl == "true";
			const result = await PostgresAdapter.testConnection(
				pgConfig as Connection,
			);
			return {
				success: result.success,
				error:
					result.error?.toString() ||
					(result.success ? "" : "Connection failed"),
			};
		case "MySQL":
			const mysqlConfig = extractMysqlConnectionInfo(
				config,
				appConfigs,
				parseMysqlUrl,
			);

			if (!mysqlConfig) {
				return {
					success: false,
					error: "Invalid configuration",
				};
			}
			const mysqlResult = await MySqlAdapter.testConnection(
				mysqlConfig as Connection,
			);
			return {
				success: mysqlResult.success,
				error:
					mysqlResult.error?.toString() ||
					(mysqlResult.success ? "" : "Connection failed"),
			};
		case "MongoDB":
			const mongoConfig = extractMongoConnectionInfo(
				config,
				appConfigs,
				parseMongoUrl,
			);

			if (!mongoConfig) {
				return {
					success: false,
					error: "Invalid configuration",
				};
			}

			const mongoResult = await MongoAdapter.testConnection(mongoConfig as any);
			return {
				success: mongoResult.success,
				error:
					mongoResult.error?.toString() ||
					(mongoResult.success ? "" : "Connection failed"),
			};
		default:
			return {
				success: false,
				error: "Invalid variant",
			};
	}
}

async function testKvConnection(
	variant: string,
	config: any,
	appConfigs: Map<string, string>,
) {
	switch (variant as z.infer<typeof kvVariantSchema>) {
		case "Redis":
			const redisResult = await RedisIntegration.TestConnection(config, appConfigs);
			return {
				success: redisResult.success,
				error: redisResult.error || (redisResult.success ? "" : "Failed to connect to Redis"),
			};
		case "Memcached":
			const memcachedResult = await MemcachedIntegration.TestConnection(config, appConfigs);
			return {
				success: memcachedResult.success,
				error: memcachedResult.error || (memcachedResult.success ? "" : "Failed to connect to Memcached"),
			};
		default:
			return { success: false, error: "Invalid variant" };
	}
}

async function testObservibilityConnection(
	variant: string,
	config: any,
	appConfigs: Map<string, string>,
) {
	switch (variant as z.infer<typeof observabilityVariantSchema>) {

		case "Open Telemetry Logs": {
			const parsed = openTelemetryLogsVariantConfigSchema.safeParse(config);
			if (!parsed.success) return { success: false, error: "Invalid Data" };
			const openTelemetryLogsResult = await OpenTelemetryLogs.TestConnection(
				parsed.data,
				appConfigs,
			);
			return {
				success: openTelemetryLogsResult,
				error: openTelemetryLogsResult ? "" : "Failed to connect to OpenTelemetry Logs",
			};
		}
		case "Loki":
			if (!lokiVariantConfigSchema.safeParse(config).success) {
				return { success: false, error: "Invalid configuration" };
			}
			const lokiResult = await LokiLogger.TestConnection(config, appConfigs);
			return {
				success: lokiResult,
				error: lokiResult ? "" : "Failed to connect to Loki",
			};
		default:
			return { success: false, error: "Invalid variant" };
	}
}

export async function testAiConnection(
	variant: string,
	config: any,
	appConfigs: Map<string, string>,
) {
	switch (variant as z.infer<typeof aiVariantSchema>) {
		case "OpenAI":
			const openAiResult = await OpenAIIntegration.TestConnection(
				config,
				appConfigs,
			);
			if (!openAiResult) {
				return { success: false, error: "Failed to connect to OpenAI" };
			}
			return { success: true, error: "" };
		case "Anthropic":
			const anthropicResult = await AnthropicIntegration.TestConnection(
				config,
				appConfigs,
			);
			if (!anthropicResult) {
				return { success: false, error: "Failed to connect to Anthropic" };
			}
			return { success: true, error: "" };
		case "Gemini":
			const geminiResult = await GeminiIntegration.TestConnection(
				config,
				appConfigs,
			);
			if (!geminiResult) {
				return { success: false, error: "Failed to connect to Gemini" };
			}
			return { success: true, error: "" };
		case "Mistral":
			const mistralResult = await MistralIntegration.TestConnection(
				config,
				appConfigs,
			);
			if (!mistralResult) {
				return { success: false, error: "Failed to connect to Mistral" };
			}
			return { success: true, error: "" };
		case "OpenAI Compatible":
			const openAiCompatibleResult =
				await OpenAICompatibleIntegration.TestConnection(config, appConfigs);
			if (!openAiCompatibleResult) {
				return {
					success: false,
					error: "Failed to connect to OpenAI Compatible",
				};
			}
			return { success: true, error: "" };
		default:
			return { success: false, error: "Invalid variant" };
	}
}

export async function decodeAppConfig(keys: string[], projectId: string) {
	const appConfigs = await getAppConfigs(keys, projectId);
	const configMap = new Map<string, string>();
	appConfigs.forEach((config) => {
		if (config.isEncrypted) {
			config.value = EncryptionService.decodeData(
				config.value!,
				config.encodingType!,
			);
			config.value = EncryptionService.decrypt(config.value);
		} else {
			config.value = EncryptionService.decodeData(
				config.value!,
				config.encodingType!,
			);
		}
		configMap.set(config.key!, config.value!);
	});
	return configMap;
}
