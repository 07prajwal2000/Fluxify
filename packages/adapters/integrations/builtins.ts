import type {
	Connection,
	DatabaseAdapter,
	IntegrationVariantDef,
	QueueConnector,
} from "@fluxify/sdk/integrations";
import { AnthropicIntegration } from "../ai/anthropic";
import { GeminiIntegration } from "../ai/gemini";
import { MistralIntegration } from "../ai/mistral";
import { OpenAIIntegration } from "../ai/openAi";
import { OpenAICompatibleIntegration } from "../ai/openAiCompatible";
import type { ManagedDbConnection } from "../db/connectionManager";
import { MongoAdapter } from "../db/mongoDbAdapter";
import { MySqlAdapter } from "../db/mySqlAdapter";
import { connectMongo, connectMysql, connectPostgres } from "../db/pools";
import { PostgresAdapter } from "../db/postgresAdapter";
import { MemcachedIntegration } from "../kv/memcached";
import { RedisIntegration } from "../kv/redis";
import { LokiLogger } from "../observability/loki";
import { OpenTelemetryLogs } from "../observability/openTelemetryLogs";
import { BUILT_IN_VARIANT_META } from "./builtinVariants";
import { BUILT_IN_OPS } from "./ops";
import { parseMongoUrl } from "./parsers/mongodb";
import { parseMysqlUrl } from "./parsers/mysql";
import { parsePostgresUrl } from "./parsers/postgres";
import { appConfigMap, expandStoredConfig } from "./resolve";

type Hooks = Record<string, Partial<IntegrationVariantDef> & Record<string, unknown>>;

const database = (
	parseUrl: (url: string) => Connection | null,
	connect: (config: Connection) => ManagedDbConnection,
	create: (pool: ManagedDbConnection) => DatabaseAdapter,
) => ({
	resolve: (stored: any, appConfig?: Record<string, any>) =>
		expandStoredConfig(appConfig, stored, parseUrl),
	connect,
	create: (_config: Connection, ctx: { pool: unknown }) => create(ctx.pool as ManagedDbConnection),
});

/** Extractors that take app config as a `Map`, and a constructor for the adapter. */
const mapped = (
	adapter: { ExtractConnectionInfo(stored: any, appConfig: Map<string, string>): any },
	create: (config: any) => unknown,
) => ({
	resolve: (stored: any, appConfig?: Record<string, any>) =>
		adapter.ExtractConnectionInfo(stored, appConfigMap(appConfig)),
	create,
});

/** A queue variant publishes through its connector module, loaded on first send. */
const queue = (type: string) => ({
	create: async (
		config: Record<string, any>,
		ctx: { loadConnector(type: string): Promise<QueueConnector> },
	) => {
		const connector = await ctx.loadConnector(type);
		if (!connector.createProducer) throw new Error(`${config.variant} cannot send messages`);
		return connector.createProducer(config);
	},
});

/** Keyed `group/variant`; a meta entry with no hooks here is listed and validated only. */
const HOOKS: Hooks = {
	"database/PostgreSQL": database(
		parsePostgresUrl,
		connectPostgres,
		(pool) => new PostgresAdapter(pool.db, pool.sql!),
	),
	"database/MySQL": database(
		parseMysqlUrl,
		connectMysql,
		(pool) => new MySqlAdapter(pool.db, pool.pool!),
	),
	"database/MongoDB": database(
		parseMongoUrl,
		connectMongo,
		(pool) => new MongoAdapter(pool.client!, pool.db),
	),
	"kv/Redis": mapped(RedisIntegration, (config) => new RedisIntegration(config)),
	"kv/Memcached": mapped(MemcachedIntegration, (config) => new MemcachedIntegration(config)),
	"ai/OpenAI": mapped(OpenAIIntegration, (config) => new OpenAIIntegration(config)),
	"ai/Anthropic": mapped(AnthropicIntegration, (config) => new AnthropicIntegration(config)),
	"ai/Gemini": mapped(GeminiIntegration, (config) => new GeminiIntegration(config)),
	"ai/Mistral": mapped(MistralIntegration, (config) => new MistralIntegration(config)),
	"ai/OpenAI Compatible": mapped(
		OpenAICompatibleIntegration,
		(config) => new OpenAICompatibleIntegration(config),
	),
	"observability/Open Telemetry": {
		resolve: (stored, appConfig) => OpenTelemetryLogs.ExtractConnectionInfo(stored, appConfig!),
		create: (config: any) => new OpenTelemetryLogs(config),
	},
	"observability/Loki": {
		resolve: (stored, appConfig) => LokiLogger.extractConnectionInfo(stored, appConfig!),
		create: (config: any) => new LokiLogger(config),
	},
	"queue/Kafka": queue("kafka"),
	"queue/NATS": queue("nats"),
	"queue/SQS": queue("sqs"),
	"queue/RabbitMQ": queue("rabbitmq"),
};

export const BUILT_IN_VARIANTS = BUILT_IN_VARIANT_META.map((meta) => {
	const key = `${meta.group}/${meta.variant}`;
	return { ...meta, ...HOOKS[key], ...BUILT_IN_OPS[key] } as IntegrationVariantDef;
});
