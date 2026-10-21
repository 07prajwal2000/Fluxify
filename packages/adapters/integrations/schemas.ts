import { BUILT_IN_INTEGRATION_GROUPS, isIntegrationGroupName } from "@fluxify/sdk/integrations";
import z from "zod";
import { parseMongoUrl } from "./parsers/mongodb";
import { parseMysqlUrl } from "./parsers/mysql";
import { parsePostgresUrl } from "./parsers/postgres";

// ALWAYS MAKE SURE THE SCHEMA IS FLAT
/** the built-in groups; request bodies take `integrationGroupNameSchema`, which also allows `acme/<group>` */
export const integrationsGroupSchema = z.enum(BUILT_IN_INTEGRATION_GROUPS);

/** Shape only: whether the group is registered is the registry's call, not this schema's. */
export const integrationGroupNameSchema = z.string().refine(isIntegrationGroupName, {
	error: (issue) => `Unknown integration group "${String(issue.input)}"`,
});

export const mcpVariantSchema = z.enum(["http"]);
export const queueVariantSchema = z.enum(["Kafka", "NATS", "SQS", "RabbitMQ"]);
export const databaseVariantSchema = z.enum(["PostgreSQL", "MongoDB", "MySQL"]);

export const kvVariantSchema = z.enum(["Redis", "Memcached"]);
export const aiVariantSchema = z.enum([
	"OpenAI",
	"Anthropic",
	"Gemini",
	"Mistral",
	"OpenAI Compatible",
]);
export const baasVariantSchema = z.enum(["Firebase", "Supabase"]);
export const observabilityVariantSchema = z.enum(["Open Telemetry", "Loki"]);

// Database
/** milliseconds before a query is stopped; the runtime uses 30s when it is left out */
const queryTimeoutMsSchema = z.number().int().positive().optional();
/** most connections the pool opens, per worker, up to `cap` (MAX_MAX_CONNECTIONS); the runtime default when left out */
const maxConnectionsSchema = (cap: number) => z.number().int().positive().max(cap).optional();

export const postgresVariantConfigSchema = z
	.object({
		dbType: z.string().refine((v: any) => v === databaseVariantSchema.enum.PostgreSQL),
		username: z.string().min(1),
		password: z.string().min(1),
		host: z.string().min(1),
		port: z.string().or(z.number()),
		database: z.string().min(1),
		useSSL: z.boolean().default(false).optional(),
		source: z.literal("credentials"),
		queryTimeoutMs: queryTimeoutMsSchema,
		maxConnections: maxConnectionsSchema(50),
	})
	.or(
		z.object({
			source: z.literal("url"),
			queryTimeoutMs: queryTimeoutMsSchema,
			maxConnections: maxConnectionsSchema(50),
			url: z
				.string()
				.min(4)
				.refine((v: any) => {
					if (v.startsWith("cfg:")) {
						return true;
					}
					const result = parsePostgresUrl(v);
					return result !== null;
				}),
		}),
	);

export const mysqlVariantConfigSchema = z
	.object({
		dbType: z.string().refine((v: any) => v === databaseVariantSchema.enum.MySQL),
		username: z.string().min(1),
		password: z.string().min(1),
		host: z.string().min(1),
		port: z.string().or(z.number()),
		database: z.string().min(1),
		source: z.literal("credentials"),
		queryTimeoutMs: queryTimeoutMsSchema,
		maxConnections: maxConnectionsSchema(50),
	})
	.or(
		z.object({
			source: z.literal("url"),
			queryTimeoutMs: queryTimeoutMsSchema,
			maxConnections: maxConnectionsSchema(50),
			url: z
				.string()
				.min(4)
				.refine((v: any) => {
					if (v.startsWith("cfg:")) {
						return true;
					}
					const result = parseMysqlUrl(v);
					return result !== null;
				}),
		}),
	);

export const mongoVariantConfigSchema = z
	.object({
		dbType: z.string().refine((v: any) => v === databaseVariantSchema.enum.MongoDB),
		username: z.string().optional(),
		password: z.string().optional(),
		host: z.string().min(1),
		port: z.string().or(z.number()),
		database: z.string().min(1),
		useSSL: z.boolean().default(false).optional(),
		source: z.literal("credentials"),
		queryTimeoutMs: queryTimeoutMsSchema,
		maxConnections: maxConnectionsSchema(100),
	})
	.or(
		z.object({
			source: z.literal("url"),
			queryTimeoutMs: queryTimeoutMsSchema,
			maxConnections: maxConnectionsSchema(100),
			url: z
				.string()
				.min(4)
				.refine((v: any) => {
					if (v.startsWith("cfg:")) {
						return true;
					}
					const result = parseMongoUrl(v);
					return result !== null;
				}),
		}),
	);

// KV
export const redisVariantConfigSchema = z
	.object({
		host: z.string().min(1),
		port: z.string().or(z.number()),
		username: z.string().optional(),
		password: z.string().optional(),
		// DB index; empty means the default DB 0. `cfg:` references resolve later.
		database: z
			.string()
			.refine((v) => v === "" || v.startsWith("cfg:") || /^\d+$/.test(v), {
				message: "DB index must be a non-negative integer",
			})
			.optional(),
		source: z.literal("credentials"),
	})
	.or(
		z.object({
			source: z.literal("url"),
			url: z.string().min(4),
		}),
	);

export const memcachedVariantConfigSchema = z
	.object({
		host: z.string().min(1),
		port: z.string().or(z.number()),
		username: z.string().optional(),
		password: z.string().optional(),
		source: z.literal("credentials"),
	})
	.or(
		z.object({
			source: z.literal("url"),
			url: z.string().min(4),
		}),
	);

// AI
export const openAIVariantConfigSchema = z.object({
	apiKey: z.string().refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
});

export const anthropicVariantConfigSchema = z.object({
	apiKey: z.string().refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
});

export const mistralVariantConfigSchema = z.object({
	apiKey: z.string().refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
});

export const geminiVariantConfigSchema = z.object({
	apiKey: z.string().refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
});

export const openAiCompatibleVariantConfigSchema = z.object({
	baseUrl: z.string().refine((v) => (v.startsWith("cfg:") ? true : z.url().safeParse(v).success)),
	apiKey: z.string().refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
});

// Observability
/**
 * Extra headers sent with every OTLP request, for ingestors that key on
 * something other than basic auth — an api key, a tenant id, a dataset name.
 * Values accept `cfg:` references like every other credential field, so a token
 * lives in app config rather than in the integration row.
 */
const customHeadersSchema = z.record(z.string().min(1), z.string()).optional();

export const openTelemetryVariantConfigSchema = z
	.object({
		baseUrl: z.string().refine((v) => (v.startsWith("cfg:") ? true : z.url().safeParse(v).success)),
		// can be object or base64 encoded basic auth
		credentials: z
			.object({
				username: z.string(),
				password: z.string(),
			})
			.or(z.string()),
		headers: customHeadersSchema,
		/** over gRPC baseUrl is the bare channel target, with no `/v1/{signal}` path */
		protocol: z.enum(["http", "grpc"]).default("http"),
		/** gRPC only. `none` is plaintext, for a collector without TLS */
		tlsMode: z.enum(["none", "tls", "mtls"]).default("tls"),
		/** PEM or `cfg:` reference. Only needed for a private CA. */
		caCert: z.string().optional(),
		/** PEM or `cfg:` reference, for mTLS */
		clientCert: z.string().optional(),
		clientKey: z.string().optional(),
	})
	.refine(
		(v) => v.protocol !== "grpc" || v.tlsMode !== "mtls" || Boolean(v.clientCert && v.clientKey),
		{ message: "mTLS needs a client certificate and key", path: ["clientCert"] },
	);

/** @deprecated the variant is now "Open Telemetry" — kept for existing importers */
export const openTelemetryLogsVariantConfigSchema = openTelemetryVariantConfigSchema;

export const lokiVariantConfigSchema = z.object({
	baseUrl: z.string().refine((v) => (v.startsWith("cfg:") ? true : z.url().safeParse(v).success)),
	// can be object or base64 encoded basic auth
	credentials: z
		.object({
			username: z.string(),
			password: z.string(),
		})
		.optional()
		.or(z.string().optional()),
	headers: customHeadersSchema,
});

// Queue
/** milliseconds the Send Message block waits for the broker; the runtime uses 30s when it is left out */
const sendTimeoutMsSchema = z.number().int().positive().optional();

export const kafkaVariantConfigSchema = z.object({
	/** comma-separated `host:port` list, or a `cfg:` reference */
	brokers: z.string().min(1),
	clientId: z.string().optional(),
	ssl: z.boolean().default(false),
	saslMechanism: z.enum(["none", "PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"]).default("none"),
	username: z.string().optional(),
	password: z.string().optional(),
	/** Advanced: where a batch that keeps failing is parked. */
	dlqTopic: z.string().optional(),
	sendTimeoutMs: sendTimeoutMsSchema,
});

/** A foreign NATS JetStream cluster — not Fluxify's own transport. */
export const natsVariantConfigSchema = z.object({
	/** comma-separated `nats://host:port` list, or a `cfg:` reference */
	servers: z.string().min(1),
	tls: z.boolean().default(false),
	token: z.string().optional(),
	user: z.string().optional(),
	pass: z.string().optional(),
	/** contents of a `.creds` file (JWT + NKey) */
	creds: z.string().optional(),
	nkeySeed: z.string().optional(),
	/** Advanced: a subject a stream captures, where failing batches are parked. */
	dlqSubject: z.string().optional(),
	/** Advanced: HTTP monitoring, `host:port`, as KEDA reaches it. Unset, Kubernetes cannot scale on this server. */
	monitoringEndpoint: z.string().optional(),
	/** Advanced: the account the stream lives in, for that monitoring. Default `$G`. */
	account: z.string().optional(),
	sendTimeoutMs: sendTimeoutMsSchema,
});

/**
 * AWS SQS. No dead-letter field: failures go to the queue's own redrive policy.
 * Blank keys fall back to the server's AWS credential chain (env, instance role).
 */
export const sqsVariantConfigSchema = z.object({
	region: z.string().min(1),
	accessKeyId: z.string().optional(),
	secretAccessKey: z.string().optional(),
	sessionToken: z.string().optional(),
	/** Advanced: an SQS-compatible endpoint, e.g. a local emulator. */
	endpoint: z.string().optional(),
	sendTimeoutMs: sendTimeoutMsSchema,
});

/**
 * RabbitMQ (AMQP 0-9-1). `database` is the virtual host, so the shared
 * credentials-or-URL form fits. No dead-letter field: failures are rejected to
 * the queue's own dead-letter exchange.
 */
export const rabbitMqVariantConfigSchema = z
	.object({
		host: z.string().min(1),
		port: z.string().or(z.number()).optional(),
		username: z.string().optional(),
		password: z.string().optional(),
		database: z.string().optional(),
		useSSL: z.boolean().default(false),
		source: z.literal("credentials"),
		sendTimeoutMs: sendTimeoutMsSchema,
	})
	.or(
		z.object({
			source: z.literal("url"),
			url: z.string().refine((v) => v.startsWith("cfg:") || /^amqps?:\/\//.test(v), {
				message: "Must be an amqp:// or amqps:// URL",
			}),
			sendTimeoutMs: sendTimeoutMsSchema,
		}),
	);

/**
 * External MCP server over Streamable HTTP. Header values may be `cfg:` references.
 * `auth: "oauth"` signs in through Connect instead; the stored connection (`oauth`) is
 * written only by Connect, refresh and Disconnect, so it is not part of this schema.
 */
export const mcpVariantConfigSchema = z.object({
	auth: z.enum(["headers", "oauth"]).default("headers"),
	url: z.string().refine((v) => /^https?:\/\/\S+$/.test(v), {
		message: "Must be an http:// or https:// URL",
	}),
	headers: z.array(z.object({ key: z.string().min(1), value: z.string() })).default([]),
});
