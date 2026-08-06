import z from "zod";
import { parsePostgresUrl } from "../../../lib/parsers/postgres";
import { parseMysqlUrl } from "../../../lib/parsers/mysql";
import { parseMongoUrl } from "../../../lib/parsers/mongodb";

// ALWAYS MAKE SURE THE SCHEMA IS FLAT
export const integrationsGroupSchema = z.enum([
	"database",
	"kv",
	"ai",
	"baas",
	"observability",
]);

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

/**
 * `"Open Telemetry Logs"` was the original name, from when logs were the only
 * signal. It is stored verbatim in `integrations.variant` and matched by literal
 * string everywhere, so existing rows keep working through this map rather than
 * through a data migration. Kept out of `observabilityVariantSchema` on purpose:
 * that enum is what the variant dropdown renders, and an alias in it would show
 * up as a second pickable entry for the same thing.
 */
const OBSERVABILITY_VARIANT_ALIASES: Record<string, string> = {
	"Open Telemetry Logs": "Open Telemetry",
};

export function normalizeObservabilityVariant(variant: string): string {
	return OBSERVABILITY_VARIANT_ALIASES[variant] ?? variant;
}

/**
 * Variant names that only ever appear on stored rows. Anything matching a
 * `integrations.variant` column against the enum needs these too, or a row
 * created before the rename reads as an unknown integration.
 */
export const observabilityLegacyVariants = Object.keys(
	OBSERVABILITY_VARIANT_ALIASES,
);

// Database
export const postgresVariantConfigSchema = z
	.object({
		dbType: z
			.string()
			.refine((v: any) => v === databaseVariantSchema.enum.PostgreSQL),
		username: z.string().min(1),
		password: z.string().min(1),
		host: z.string().min(1),
		port: z.string().or(z.number()),
		database: z.string().min(1),
		useSSL: z.boolean().default(false).optional(),
		source: z.literal("credentials"),
	})
	.or(
		z.object({
			source: z.literal("url"),
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
		dbType: z
			.string()
			.refine((v: any) => v === databaseVariantSchema.enum.MySQL),
		username: z.string().min(1),
		password: z.string().min(1),
		host: z.string().min(1),
		port: z.string().or(z.number()),
		database: z.string().min(1),
		source: z.literal("credentials"),
	})
	.or(
		z.object({
			source: z.literal("url"),
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
		dbType: z
			.string()
			.refine((v: any) => v === databaseVariantSchema.enum.MongoDB),
		username: z.string().optional(),
		password: z.string().optional(),
		host: z.string().min(1),
		port: z.string().or(z.number()),
		database: z.string().min(1),
		useSSL: z.boolean().default(false).optional(),
		source: z.literal("credentials"),
	})
	.or(
		z.object({
			source: z.literal("url"),
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
// `useForHarness` opts an AI integration into the agent harness pool: when true,
// users can pick this integration to drive a harness conversation run. Defaults
// to false so nothing is harness-eligible until explicitly enabled.
// TODO(ui): build a toggle in the AI integration form to flip `useForHarness`.
export const openAIVariantConfigSchema = z.object({
	apiKey: z
		.string()
		.refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
	useForHarness: z.boolean().default(false),
});

export const anthropicVariantConfigSchema = z.object({
	apiKey: z
		.string()
		.refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
	useForHarness: z.boolean().default(false),
});

export const mistralVariantConfigSchema = z.object({
	apiKey: z
		.string()
		.refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
	useForHarness: z.boolean().default(false),
});

export const geminiVariantConfigSchema = z.object({
	apiKey: z
		.string()
		.refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
	useForHarness: z.boolean().default(false),
});

export const openAiCompatibleVariantConfigSchema = z.object({
	baseUrl: z
		.string()
		.refine((v) =>
			v.startsWith("cfg:") ? true : z.url().safeParse(v).success,
		),
	apiKey: z
		.string()
		.refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
	useForHarness: z.boolean().default(false),
});

// Observability
/**
 * Extra headers sent with every OTLP request, for ingestors that key on
 * something other than basic auth — an api key, a tenant id, a dataset name.
 * Values accept `cfg:` references like every other credential field, so a token
 * lives in app config rather than in the integration row.
 */
const customHeadersSchema = z.record(z.string().min(1), z.string()).optional();

export const openTelemetryVariantConfigSchema = z.object({
	baseUrl: z
		.string()
		.refine((v) =>
			v.startsWith("cfg:") ? true : z.url().safeParse(v).success,
		),
	// can be object or base64 encoded basic auth
	credentials: z
		.object({
			username: z.string(),
			password: z.string(),
		})
		.or(z.string()),
	headers: customHeadersSchema,
});

/** @deprecated the variant is now "Open Telemetry" — kept for existing importers */
export const openTelemetryLogsVariantConfigSchema =
	openTelemetryVariantConfigSchema;

export const lokiVariantConfigSchema = z.object({
	baseUrl: z
		.string()
		.refine((v) =>
			v.startsWith("cfg:") ? true : z.url().safeParse(v).success,
		),
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

export const databaseTagsSchema = z.enum(["sql", "nosql"]);
export const aiTagsSchema = z.enum(["llm", "embedding"]);
export const observabilityTagsSchema = z.enum(["logs", "metrics", "traces"]);
export const kvTagsSchema = z.enum(["redis", "kv", "redis-compatible"]);
export function getIntegrationTags(
	group: z.infer<typeof integrationsGroupSchema>,
	variant: string,
): string[] {
	if (group === "observability") {
		variant = normalizeObservabilityVariant(variant);
		const result = observabilityVariantSchema.safeParse(variant);
		if (!result.success) {
			return [];
		}
		// One OTLP endpoint carries all three signals — whether a project actually
		// exports a given one is decided by which `settings.telemetry.*` key points
		// at this integration, not here. These tags say what it *can* do, which is
		// what the client filters the picker on.
		if (variant === "Open Telemetry") {
			return [...observabilityTagsSchema.options];
		}
		if (variant === "Loki") {
			return [
				...observabilityTagsSchema.exclude(["metrics", "traces"]).options,
			];
		}
	}
	if (group === "database") {
		const result = databaseVariantSchema.safeParse(variant);
		if (!result.success) {
			return [];
		}
		if (variant === "PostgreSQL" || variant === "MySQL") {
			return [...databaseTagsSchema.exclude(["nosql"]).options];
		}
		if (variant === "MongoDB") {
			return [...databaseTagsSchema.exclude(["sql"]).options];
		}
	}
	if (group === "ai") {
		const result = aiVariantSchema.safeParse(variant);
		if (!result.success) {
			return [];
		}
		if (
			variant === "OpenAI" ||
			variant === "Anthropic" ||
			variant === "Gemini" ||
			variant === "Mistral"
		) {
			return [...aiTagsSchema.exclude(["embedding"]).options];
		}
		if (variant === "OpenAI Compatible") {
			return [...aiTagsSchema.options];
		}
	}
	if (group === "kv") {
		const result = kvVariantSchema.safeParse(variant);
		if (!result.success) {
			return [];
		}
		if (variant === "Redis") {
			return [...kvTagsSchema.options];
		}
		if (variant === "Memcached") {
			return [...kvTagsSchema.exclude(["redis", "redis-compatible"]).options];
		}
	}
	return [];
}
