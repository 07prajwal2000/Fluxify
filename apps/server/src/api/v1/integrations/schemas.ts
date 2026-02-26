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
export const observabilityVariantSchema = z.enum(["Open Observe", "Loki"]);

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

// AI
export const openAIVariantConfigSchema = z.object({
	apiKey: z
		.string()
		.refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
});

export const anthropicVariantConfigSchema = z.object({
	apiKey: z
		.string()
		.refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
});

export const mistralVariantConfigSchema = z.object({
	apiKey: z
		.string()
		.refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
});

export const geminiVariantConfigSchema = z.object({
	apiKey: z
		.string()
		.refine((v) => (v.startsWith("cfg:") ? true : v.length > 1)),
	model: z.string().min(1),
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
});

// Observability
export const openObserveVariantConfigSchema = z.object({
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
});

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
});
