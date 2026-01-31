import z, { ZodType } from "zod";
import {
  integrationsGroupSchema,
  databaseVariantSchema,
  postgresVariantConfigSchema,
  kvVariantSchema,
  observabilityVariantSchema,
  openObserveVariantConfigSchema,
  baasVariantSchema,
  aiVariantSchema,
} from "./schemas";

type Variants =
  | keyof typeof databaseVariantSchema.enum
  | keyof typeof kvVariantSchema.enum
  | keyof typeof observabilityVariantSchema.enum
  | keyof typeof aiVariantSchema.enum
  | keyof typeof baasVariantSchema.enum;

export const humanReadableConnectorNames = {
  database: "Databases",
  kv: "Key Value store",
  ai: "Artifical Intelligence",
  baas: "Backend as a Service",
  observability: "Observability",
};

export function getIntegrationsGroups() {
  return Object.values(integrationsGroupSchema.options);
}

export function getIntegrationsVariants(
  group: z.infer<typeof integrationsGroupSchema>,
) {
  if (group === "database") {
    return Object.values(databaseVariantSchema.options);
  }
  if (group === "observability") {
    return Object.values(observabilityVariantSchema.options);
  }
  return [];
}

export function getDefaultVariantValue(variant: Variants) {
  if (variant === "PostgreSQL") {
    return {
      host: "",
      port: 0,
      database: "",
      username: "",
      password: "",
      dbType: databaseVariantSchema.enum.PostgreSQL,
      url: "",
      useSSL: false,
      source: "credentials",
    } as z.infer<typeof postgresVariantConfigSchema>;
  }
  if (variant === "Open Observe") {
    return {
      baseUrl: "",
      credentials: {
        username: "",
        password: "",
      },
    } as z.infer<typeof openObserveVariantConfigSchema>;
  }
  return null;
}

export function getSchema(
  group: z.infer<typeof integrationsGroupSchema>,
  variant: string,
) {
  let schema: ZodType = null!;
  if (group === "database") {
    const result = databaseVariantSchema.safeParse(variant);
    if (!result.success) {
      return null;
    }
    switch (variant as z.infer<typeof databaseVariantSchema>) {
      case "PostgreSQL":
        schema = postgresVariantConfigSchema;
        break;
      default:
        return null;
    }
  } else if (group === "kv") {
    const result = kvVariantSchema.safeParse(variant);
    if (!result.success) {
      return null;
    }
    switch (variant as z.infer<typeof kvVariantSchema>) {
      default:
        return null;
    }
  } else if (group === "observability") {
    const result = observabilityVariantSchema.safeParse(variant);
    if (!result.success) {
      return null;
    }
    switch (variant as z.infer<typeof observabilityVariantSchema>) {
      case "Open Observe":
        schema = openObserveVariantConfigSchema;
        break;
    }
  }
  return schema;
}
