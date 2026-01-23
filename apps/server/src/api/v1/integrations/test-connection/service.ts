import { z } from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import { databaseVariantSchema, integrationsGroupSchema } from "../schemas";
import { getAppConfigKeysFromData } from "../create/service";
import { getAppConfigs } from "./repository";
import { parsePostgresUrl } from "../../../../lib/parsers/postgres";
import { PostgresAdapter } from "@fluxify/adapters";
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
      const pgConfig = extractPgConnectionInfo(config, appConfigs);
      if (!pgConfig) {
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

function extractPgConnectionInfo(config: any, appConfigs: Map<string, string>) {
  if (config.source === "url") {
    config.url = config.url.startsWith("cfg:")
      ? appConfigs.get(config.url.slice(4)) || ""
      : config.url;
    const result = parsePostgresUrl(config.url);
    if (result === null) {
      return null;
    }
    return {
      host: result.host,
      port: result.port,
      database: result.database,
      username: result.username,
      password: result.password,
      ssl: result.ssl === true,
      dbType: result.dbType,
    };
  }
  for (const key in config) {
    const value = config[key].toString();
    if (value.startsWith("cfg:")) {
      config[key] = appConfigs.get(value.slice(4)) || "";
    } else {
      config[key] = value;
    }
  }
  return config;
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
