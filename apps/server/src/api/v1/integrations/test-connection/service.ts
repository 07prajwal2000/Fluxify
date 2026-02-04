import { z } from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import {
  databaseVariantSchema,
  integrationsGroupSchema,
  lokiVariantConfigSchema,
  observabilityVariantSchema,
  openObserveVariantConfigSchema,
  postgresVariantConfigSchema,
} from "../schemas";
import { getAppConfigKeysFromData } from "../create/service";
import { getAppConfigs } from "./repository";
import { parsePostgresUrl } from "../../../../lib/parsers/postgres";
import {
  extractPgConnectionInfo,
  LokiLogger,
  OpenObserve,
  PostgresAdapter,
} from "@fluxify/adapters";
import { EncryptionService } from "../../../../lib/encryption";
import { getSchema } from "../helpers";

export async function testIntegrationConnection(
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
  const appConfigs = await decodeAppConfig(keys);

  switch (group) {
    case "database":
      return testDatabasesConnection(variant, config, appConfigs);
    case "kv":
      break;
    case "ai":
      break;
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
  body: z.infer<typeof requestBodySchema>,
): Promise<z.infer<typeof responseSchema>> {
  const { group, variant, config: data } = body;
  return testIntegrationConnection(group, variant, data);
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
      if (
        !pgConfig ||
        !postgresVariantConfigSchema.safeParse(pgConfig).success
      ) {
        return {
          success: false,
          error: "Invalid configuration",
        };
      }
      pgConfig.ssl = pgConfig.ssl == "true";
      const result = await PostgresAdapter.testConnection(pgConfig);
      return {
        success: result.success,
        error:
          result.error?.toString() ||
          (result.success ? "" : "Connection failed"),
      };
    default:
      return {
        success: false,
        error: "Invalid variant",
      };
  }
}

async function testObservibilityConnection(
  variant: string,
  config: any,
  appConfigs: Map<string, string>,
) {
  switch (variant as z.infer<typeof observabilityVariantSchema>) {
    case "Open Observe":
      if (!openObserveVariantConfigSchema.safeParse(config).success) {
        return { success: false, error: "Invalid configuration" };
      }
      const openObserveConfig = OpenObserve.extractConnectionInfo(
        config,
        appConfigs,
      );
      if (!openObserveConfig) {
        return { success: false, error: "Invalid configuration" };
      }
      const openObserveResult =
        await OpenObserve.TestConnection(openObserveConfig);
      if (!openObserveResult) {
        return { success: false, error: "Failed to connect to Open Observe" };
      }
      return { success: true, error: "" };

    case "Loki":
      if (!lokiVariantConfigSchema.safeParse(config).success) {
        return { success: false, error: "Invalid configuration" };
      }
      const lokiConfig = LokiLogger.extractConnectionInfo(config, appConfigs);
      if (!lokiConfig) {
        return { success: false, error: "Invalid configuration" };
      }
      const lokiResult = await LokiLogger.TestConnection(lokiConfig);
      if (!lokiResult) {
        return { success: false, error: "Failed to connect to Loki" };
      }
      return { success: true, error: "" };
    default:
      return { success: false, error: "Invalid variant" };
  }
}

async function decodeAppConfig(keys: string[]) {
  const appConfigs = await getAppConfigs(keys);
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
