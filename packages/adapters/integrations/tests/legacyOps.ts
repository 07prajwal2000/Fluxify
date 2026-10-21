// Fixture: the test-connection and metadata switches exactly as they were before the op
// hooks (I3, #903), copied from apps/server/src/api/v1/integrations/{test-connection,
// get-metadata}/service.ts with only the imports changed (the five identical AI cases are
// one table). `ops.spec.ts` checks every built-in's hook against these. Never edit them
// to make a test pass.
import { type Connection, DbType } from "@fluxify/sdk/integrations";
import { AnthropicIntegration } from "../../ai/anthropic";
import { GeminiIntegration } from "../../ai/gemini";
import { MistralIntegration } from "../../ai/mistral";
import { OpenAIIntegration } from "../../ai/openAi";
import { OpenAICompatibleIntegration } from "../../ai/openAiCompatible";
import { extractMongoConnectionInfo, MongoAdapter } from "../../db/mongoDbAdapter";
import { extractMysqlConnectionInfo, MySqlAdapter } from "../../db/mySqlAdapter";
import { extractPgConnectionInfo, PostgresAdapter } from "../../db/postgresAdapter";
import { MemcachedIntegration } from "../../kv/memcached";
import { RedisIntegration } from "../../kv/redis";
import { LokiLogger } from "../../observability/loki";
import { type OtlpSignal, OpenTelemetryLogs } from "../../observability/openTelemetryLogs";
import { parseMongoUrl } from "../parsers/mongodb";
import { parseMysqlUrl } from "../parsers/mysql";
import { parsePostgresUrl } from "../parsers/postgres";
import { lokiVariantConfigSchema, openTelemetryVariantConfigSchema } from "../schemas";

export async function testDatabasesConnection(
	variant: string,
	config: any,
	appConfigs: Map<string, string>,
) {
	switch (variant) {
		case "PostgreSQL": {
			const pgConfig = extractPgConnectionInfo(config, appConfigs, parsePostgresUrl);
			if (!pgConfig) return { success: false, error: "Invalid configuration" };
			pgConfig.ssl = pgConfig.ssl == "true";
			const result = await PostgresAdapter.testConnection(pgConfig as Connection);
			return {
				success: result.success,
				error: result.error?.toString() || (result.success ? "" : "Connection failed"),
			};
		}
		case "MySQL": {
			const mysqlConfig = extractMysqlConnectionInfo(config, appConfigs, parseMysqlUrl);
			if (!mysqlConfig) return { success: false, error: "Invalid configuration" };
			const mysqlResult = await MySqlAdapter.testConnection(mysqlConfig as Connection);
			return {
				success: mysqlResult.success,
				error: mysqlResult.error?.toString() || (mysqlResult.success ? "" : "Connection failed"),
			};
		}
		case "MongoDB": {
			const mongoConfig = extractMongoConnectionInfo(config, appConfigs, parseMongoUrl);
			if (!mongoConfig) return { success: false, error: "Invalid configuration" };
			const mongoResult = await MongoAdapter.testConnection(mongoConfig as any);
			return {
				success: mongoResult.success,
				error: mongoResult.error?.toString() || (mongoResult.success ? "" : "Connection failed"),
				warning: mongoResult.warning,
			};
		}
		default:
			return { success: false, error: "Invalid variant" };
	}
}

export async function testKvConnection(variant: string, config: any, appConfigs: Map<string, string>) {
	switch (variant) {
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
					memcachedResult.error || (memcachedResult.success ? "" : "Failed to connect to Memcached"),
			};
		}
		default:
			return { success: false, error: "Invalid variant" };
	}
}

export async function testObservibilityConnection(
	variant: string,
	config: any,
	appConfigs: Map<string, string>,
	signal: OtlpSignal,
) {
	switch (variant) {
		case "Open Telemetry": {
			const parsed = openTelemetryVariantConfigSchema.safeParse(config);
			if (!parsed.success) return { success: false, error: "Invalid Data" };
			const ok = await OpenTelemetryLogs.TestConnection(parsed.data, appConfigs, signal);
			return { success: ok, error: ok ? "" : `Failed to send ${signal} to the OpenTelemetry endpoint` };
		}
		case "Loki": {
			if (!lokiVariantConfigSchema.safeParse(config).success) {
				return { success: false, error: "Invalid configuration" };
			}
			if (signal !== "logs") return { success: false, error: `Loki cannot receive ${signal}` };
			const lokiResult = await LokiLogger.TestConnection(config, appConfigs);
			return { success: lokiResult, error: lokiResult ? "" : "Failed to connect to Loki" };
		}
		default:
			return { success: false, error: "Invalid variant" };
	}
}

const AI: Record<string, { TestConnection(c: any, a: Map<string, string>): Promise<boolean> }> = {
	OpenAI: OpenAIIntegration,
	Anthropic: AnthropicIntegration,
	Gemini: GeminiIntegration,
	Mistral: MistralIntegration,
	"OpenAI Compatible": OpenAICompatibleIntegration,
};

/** the old five cases, each `if (!ok) Failed to connect to <name>` */
export async function testAiConnection(variant: string, config: any, appConfigs: Map<string, string>) {
	const provider = AI[variant];
	if (!provider) return { success: false, error: "Invalid variant" };
	if (!(await provider.TestConnection(config, appConfigs))) {
		return { success: false, error: `Failed to connect to ${variant}` };
	}
	return { success: true, error: "" };
}

/** get-metadata's `buildConnection` */
export function buildConnection(variant: string, config: any, appConfigs: Map<string, string>) {
	switch (variant) {
		case "PostgreSQL": {
			const cfg = extractPgConnectionInfo(config, appConfigs, parsePostgresUrl);
			if (!cfg) break;
			return { ...(cfg as Record<string, any>), ssl: cfg.ssl == "true", dbType: DbType.POSTGRES } as Connection;
		}
		case "MySQL": {
			const cfg = extractMysqlConnectionInfo(config, appConfigs, parseMysqlUrl);
			if (!cfg) break;
			return { ...(cfg as Record<string, any>), dbType: DbType.MYSQL } as Connection;
		}
		case "MongoDB": {
			const cfg = extractMongoConnectionInfo(config, appConfigs, parseMongoUrl);
			if (!cfg) break;
			return { ...(cfg as Record<string, any>), dbType: DbType.MONGODB } as Connection;
		}
	}
	throw new Error("Invalid configuration");
}
