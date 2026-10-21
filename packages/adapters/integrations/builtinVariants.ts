import type { IntegrationGroup, IntegrationVariantMeta } from "@fluxify/sdk/integrations";
import type z from "zod";
import * as s from "./schemas";

/**
 * The built-in variants as data: names, tags and config schemas, no drivers.
 * `./builtins` adds the hooks that need one. Pure on purpose — the portal's
 * forms read these schemas, and it must never bundle a database client.
 */

export const BUILT_IN_GROUP_LABELS: Record<IntegrationGroup, string> = {
	database: "Databases",
	kv: "Key Value store",
	ai: "AI",
	baas: "Backend as a Service",
	observability: "Observability",
	queue: "Message queues",
	mcp: "MCP servers",
};

/**
 * Keyed by the group's variant enum, so a variant added to an enum without an
 * entry here (for a database: without its condition editor) fails typecheck.
 */
type Table<G extends IntegrationGroup, E extends z.ZodEnum> = {
	[K in z.infer<E> & string]: Omit<IntegrationVariantMeta<G>, "group" | "variant" | "label">;
};

const SQL = ["sql"];
const LLM = ["llm"];

const database = {
	PostgreSQL: {
		configSchema: s.postgresVariantConfigSchema,
		tags: SQL,
		extras: { conditionEditor: "sql", dbType: "pg" },
	},
	MongoDB: {
		configSchema: s.mongoVariantConfigSchema,
		tags: ["nosql"],
		extras: { conditionEditor: "js", dbType: "mongo" },
	},
	MySQL: {
		configSchema: s.mysqlVariantConfigSchema,
		tags: SQL,
		extras: { conditionEditor: "sql", dbType: "mysql" },
	},
} satisfies Table<"database", typeof s.databaseVariantSchema>;

const kv = {
	Redis: { configSchema: s.redisVariantConfigSchema, tags: ["redis", "kv", "redis-compatible"] },
	Memcached: { configSchema: s.memcachedVariantConfigSchema, tags: ["kv"] },
} satisfies Table<"kv", typeof s.kvVariantSchema>;

const ai = {
	OpenAI: { configSchema: s.openAIVariantConfigSchema, tags: LLM },
	Anthropic: { configSchema: s.anthropicVariantConfigSchema, tags: LLM },
	Gemini: { configSchema: s.geminiVariantConfigSchema, tags: LLM },
	Mistral: { configSchema: s.mistralVariantConfigSchema, tags: LLM },
	"OpenAI Compatible": {
		configSchema: s.openAiCompatibleVariantConfigSchema,
		tags: ["llm", "embedding"],
	},
} satisfies Table<"ai", typeof s.aiVariantSchema>;

const observability = {
	// One OTLP endpoint carries all three signals; which a project exports is
	// decided by its `settings.telemetry.*` keys, not here.
	"Open Telemetry": {
		configSchema: s.openTelemetryVariantConfigSchema,
		tags: ["logs", "metrics", "traces"],
		// the original name, from when logs were the only signal. Stored verbatim on
		// rows, so they keep working through the alias rather than a data migration.
		aliases: ["Open Telemetry Logs"],
	},
	Loki: { configSchema: s.lokiVariantConfigSchema, tags: ["logs"] },
} satisfies Table<"observability", typeof s.observabilityVariantSchema>;

const queue = {
	Kafka: { configSchema: s.kafkaVariantConfigSchema },
	NATS: { configSchema: s.natsVariantConfigSchema },
	SQS: { configSchema: s.sqsVariantConfigSchema },
	RabbitMQ: { configSchema: s.rabbitMqVariantConfigSchema },
} satisfies Table<"queue", typeof s.queueVariantSchema>;

const mcp = {
	http: { configSchema: s.mcpVariantConfigSchema },
} satisfies Table<"mcp", typeof s.mcpVariantSchema>;

// baas has variant names (`baasVariantSchema`) but no implementation, so none is offered
const tables: { [G in IntegrationGroup]?: Record<string, object> } = {
	database,
	kv,
	ai,
	observability,
	queue,
	mcp,
};

/** Every built-in variant, in the order the integrations page lists them. */
export const BUILT_IN_VARIANT_META = Object.entries(tables).flatMap(([group, table]) =>
	Object.entries(table!).map(
		([variant, meta]) => ({ group, variant, label: variant, ...meta }) as IntegrationVariantMeta,
	),
);

/** A built-in variant by its name or a stored alias. Pure; runtime code asks `integrationRegistry`. */
export function builtInVariantMeta(group: string, variant: string) {
	return BUILT_IN_VARIANT_META.find(
		(meta) => meta.group === group && (meta.variant === variant || meta.aliases?.includes(variant)),
	);
}
