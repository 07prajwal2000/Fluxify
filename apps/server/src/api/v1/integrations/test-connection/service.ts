import {
	AnthropicIntegration,
	type Connection,
	extractMongoConnectionInfo,
	extractMysqlConnectionInfo,
	extractPgConnectionInfo,
	GeminiIntegration,
	LokiLogger,
	MemcachedIntegration,
	MistralIntegration,
	MongoAdapter,
	MySqlAdapter,
	OpenAICompatibleIntegration,
	OpenAIIntegration,
	OpenTelemetryLogs,
	type OtlpSignal,
	PostgresAdapter,
	RedisIntegration,
} from "@fluxify/adapters";
import type { z } from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import { EncryptionService } from "../../../../lib/encryption";
import type { FluxifyEnv } from "../../../../lib/env";
import { missingAppConfigMessage, pickValue } from "../../../../lib/envValues";
import { parseMongoUrl } from "../../../../lib/parsers/mongodb";
import { parseMysqlUrl } from "../../../../lib/parsers/mysql";
import { parsePostgresUrl } from "../../../../lib/parsers/postgres";
import { ADMIN_CONNECTION_ENV, SET_ONE } from "../adminEnv";
import { getAppConfigKeysFromData } from "../create/service";
import { getSchema } from "../helpers";
import {
	type aiVariantSchema,
	type databaseVariantSchema,
	type integrationsGroupSchema,
	type kvVariantSchema,
	lokiVariantConfigSchema,
	normalizeObservabilityVariant,
	type observabilityVariantSchema,
	openTelemetryVariantConfigSchema,
	postgresVariantConfigSchema,
} from "../schemas";
import type { requestBodySchema, responseSchema } from "./dto";
import { getAppConfigs } from "./repository";

type Result = z.infer<typeof responseSchema>;

export const CONNECTION_TEST_TIMEOUT_MS = 10_000;

/**
 * Always answers with the reason (#672). Some probes throw (an AI provider
 * refusing the key) and some never settle (a host that drops packets), and both
 * used to reach the caller as a bare 500 or a hang, with the cause lost.
 */
export async function testIntegrationConnection(
	projectId: string,
	group: z.infer<typeof integrationsGroupSchema>,
	variant: string,
	config: any,
	/** which signal to probe; observability only, defaults to logs */
	signal: OtlpSignal = "logs",
	timeoutMs = CONNECTION_TEST_TIMEOUT_MS,
	/** whose app config values `cfg:` references read */
	env: FluxifyEnv = ADMIN_CONNECTION_ENV,
): Promise<Result> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<Result>((resolve) => {
		timer = setTimeout(
			() =>
				resolve({
					success: false,
					error: `Connection timed out after ${timeoutMs / 1000} seconds`,
				}),
			timeoutMs,
		);
	});
	const probe = probeConnection(projectId, group, variant, config, signal, env).catch(
		(error: unknown): Result => ({
			success: false,
			error: (error instanceof Error ? error.message : String(error)) || "Connection failed",
		}),
	);
	try {
		return await Promise.race([probe, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

async function probeConnection(
	projectId: string,
	group: z.infer<typeof integrationsGroupSchema>,
	variant: string,
	config: any,
	signal: OtlpSignal,
	env: FluxifyEnv,
): Promise<Result> {
	const schema = getSchema(group, variant);
	if (!schema) {
		return {
			success: false,
			error: "Invalid group or variant",
		};
	}
	const result = schema.safeParse(config);

	if (!result.success) {
		const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
		return { success: false, error: `Invalid configuration: ${issues.join("; ")}` };
	}
	const integrationData = result.data;
	const keys = getAppConfigKeysFromData(integrationData);
	const appConfigs = await decodeAppConfig(keys, projectId, env);

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
			return testObservibilityConnection(variant, config, appConfigs, signal);
		case "queue":
			return testQueueConnection(variant, integrationData, appConfigs);
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
): Promise<Result> {
	return testIntegrationConnection(projectId, body.group, body.variant, body.config);
}

async function testDatabasesConnection(
	variant: string,
	config: any,
	appConfigs: Map<string, string>,
) {
	switch (variant as z.infer<typeof databaseVariantSchema>) {
		case "PostgreSQL": {
			const pgConfig = extractPgConnectionInfo(config, appConfigs, parsePostgresUrl);

			if (!pgConfig) {
				return {
					success: false,
					error: "Invalid configuration",
				};
			}
			pgConfig.ssl = pgConfig.ssl == "true";
			const result = await PostgresAdapter.testConnection(pgConfig as Connection);
			return {
				success: result.success,
				error: result.error?.toString() || (result.success ? "" : "Connection failed"),
			};
		}
		case "MySQL": {
			const mysqlConfig = extractMysqlConnectionInfo(config, appConfigs, parseMysqlUrl);

			if (!mysqlConfig) {
				return {
					success: false,
					error: "Invalid configuration",
				};
			}
			const mysqlResult = await MySqlAdapter.testConnection(mysqlConfig as Connection);
			return {
				success: mysqlResult.success,
				error: mysqlResult.error?.toString() || (mysqlResult.success ? "" : "Connection failed"),
			};
		}
		case "MongoDB": {
			const mongoConfig = extractMongoConnectionInfo(config, appConfigs, parseMongoUrl);

			if (!mongoConfig) {
				return {
					success: false,
					error: "Invalid configuration",
				};
			}

			const mongoResult = await MongoAdapter.testConnection(mongoConfig as any);
			return {
				success: mongoResult.success,
				error: mongoResult.error?.toString() || (mongoResult.success ? "" : "Connection failed"),
				warning: mongoResult.warning,
			};
		}
		default:
			return {
				success: false,
				error: "Invalid variant",
			};
	}
}

async function testKvConnection(variant: string, config: any, appConfigs: Map<string, string>) {
	switch (variant as z.infer<typeof kvVariantSchema>) {
		case "Redis": {
			const redisResult = await RedisIntegration.TestConnection(config, appConfigs);
			return {
				success: redisResult.success,
				error: redisResult.error || (redisResult.success ? "" : "Failed to connect to Redis"),
			};
		}
		case "Memcached": {
			const memcachedResult = await MemcachedIntegration.TestConnection(config, appConfigs);
			return {
				success: memcachedResult.success,
				error:
					memcachedResult.error ||
					(memcachedResult.success ? "" : "Failed to connect to Memcached"),
			};
		}
		default:
			return { success: false, error: "Invalid variant" };
	}
}

async function testObservibilityConnection(
	variant: string,
	config: any,
	appConfigs: Map<string, string>,
	signal: OtlpSignal,
) {
	// stored rows may still carry the pre-rename variant; `getSchema` already
	// normalizes, so without this the config validates and then falls through to
	// "Invalid variant"
	switch (normalizeObservabilityVariant(variant) as z.infer<typeof observabilityVariantSchema>) {
		case "Open Telemetry": {
			const parsed = openTelemetryVariantConfigSchema.safeParse(config);
			if (!parsed.success) return { success: false, error: "Invalid Data" };
			const openTelemetryLogsResult = await OpenTelemetryLogs.TestConnection(
				parsed.data,
				appConfigs,
				signal,
			);
			return {
				success: openTelemetryLogsResult,
				error: openTelemetryLogsResult
					? ""
					: `Failed to send ${signal} to the OpenTelemetry endpoint`,
			};
		}
		case "Loki": {
			if (!lokiVariantConfigSchema.safeParse(config).success) {
				return { success: false, error: "Invalid configuration" };
			}
			// Loki carries logs and nothing else, which is why it is not tagged for
			// the other two — say so rather than probing an endpoint it never has
			if (signal !== "logs") {
				return { success: false, error: `Loki cannot receive ${signal}` };
			}
			const lokiResult = await LokiLogger.TestConnection(config, appConfigs);
			return {
				success: lokiResult,
				error: lokiResult ? "" : "Failed to connect to Loki",
			};
		}
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
		case "OpenAI": {
			const openAiResult = await OpenAIIntegration.TestConnection(config, appConfigs);
			if (!openAiResult) {
				return { success: false, error: "Failed to connect to OpenAI" };
			}
			return { success: true, error: "" };
		}
		case "Anthropic": {
			const anthropicResult = await AnthropicIntegration.TestConnection(config, appConfigs);
			if (!anthropicResult) {
				return { success: false, error: "Failed to connect to Anthropic" };
			}
			return { success: true, error: "" };
		}
		case "Gemini": {
			const geminiResult = await GeminiIntegration.TestConnection(config, appConfigs);
			if (!geminiResult) {
				return { success: false, error: "Failed to connect to Gemini" };
			}
			return { success: true, error: "" };
		}
		case "Mistral": {
			const mistralResult = await MistralIntegration.TestConnection(config, appConfigs);
			if (!mistralResult) {
				return { success: false, error: "Failed to connect to Mistral" };
			}
			return { success: true, error: "" };
		}
		case "OpenAI Compatible": {
			const openAiCompatibleResult = await OpenAICompatibleIntegration.TestConnection(
				config,
				appConfigs,
			);
			if (!openAiCompatibleResult) {
				return {
					success: false,
					error: "Failed to connect to OpenAI Compatible",
				};
			}
			return { success: true, error: "" };
		}
		default:
			return { success: false, error: "Invalid variant" };
	}
}

/** A queue client is loaded only when probed. */
async function testQueueConnection(variant: string, config: any, appConfigs: Map<string, string>) {
	if (variant === "NATS") {
		const { testNatsConnection } = await import("@fluxify/adapters/queue/nats");
		return testNatsConnection(expandCfg(config, appConfigs) as any);
	}
	if (variant === "SQS") {
		const { testSqsConnection } = await import("@fluxify/adapters/queue/sqs");
		return testSqsConnection(expandCfg(config, appConfigs) as any);
	}
	if (variant === "RabbitMQ") {
		const { testRabbitMqConnection } = await import("@fluxify/adapters/queue/rabbitmq");
		return testRabbitMqConnection(expandCfg(config, appConfigs) as any);
	}
	const { testKafkaConnection } = await import("@fluxify/adapters/queue/kafka");
	return testKafkaConnection(expandCfg(config, appConfigs) as any);
}

/** A stored queue integration's config with its `cfg:` references resolved. */
export async function resolveQueueConfig(
	projectId: string,
	config: Record<string, unknown>,
	env: FluxifyEnv,
) {
	const appConfigs = await decodeAppConfig(getAppConfigKeysFromData(config), projectId, env);
	return expandCfg(config, appConfigs);
}

function expandCfg(config: Record<string, unknown>, appConfigs: Map<string, string>) {
	return Object.fromEntries(
		Object.entries(config).map(([key, value]) => [
			key,
			typeof value === "string" && value.startsWith("cfg:")
				? appConfigs.get(value.slice(4))
				: value,
		]),
	);
}

/** the referenced keys' values as `env` sees them; a key development has none for is a 400 */
export async function decodeAppConfig(keys: string[], projectId: string, env: FluxifyEnv) {
	const appConfigs = await getAppConfigs(keys, projectId);
	const configMap = new Map<string, string>();
	for (const config of appConfigs) {
		const stored = pickValue(env, config.syncDev, config.value, config.devValue);
		if (stored === null) {
			throw new BadRequestError(`${missingAppConfigMessage(config.key!)}. ${SET_ONE}`);
		}
		let value = EncryptionService.decodeData(stored, config.encodingType!);
		if (config.isEncrypted) value = EncryptionService.decrypt(value);
		configMap.set(config.key!, value);
	}
	return configMap;
}
