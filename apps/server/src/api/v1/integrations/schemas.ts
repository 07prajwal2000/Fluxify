import z from "zod";
import { parsePostgresUrl } from "../../../lib/parsers/postgres";

// ALWAYS MAKE SURE THE SCHEMA IS FLAT
export const integrationsGroupSchema = z.enum(["database", "kv", "ai", "baas"]);

export const databaseVariantSchema = z.enum(["PostgreSQL", "MongoDB", "MySQL"]);
export const kvVariantSchema = z.enum(["Redis", "Memcached"]);
export const aiVariantSchema = z.enum([
  "OpenAI",
  "Anthropic",
  "OpenAI Compatible",
]);
export const baasVariantSchema = z.enum(["Firebase", "Supabase"]);

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
