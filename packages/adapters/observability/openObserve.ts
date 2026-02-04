import z from "zod";
import { AbstractLogger, HttpBufferedTransport } from "@fluxify/lib";
import pino from "pino";

export const openObserveSettings = z.object({
  baseUrl: z.url(), // e.g. http://localhost:5080/api/<ORG_ID>
  credentials: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .optional(),
  encodedBasicAuth: z.string().optional(),
  projectId: z.uuidv7(),
  routeId: z.uuidv7(),
});

type ConfigType = Map<string, string | number | boolean> | Record<string, any>;

export class OpenObserve implements AbstractLogger {
  constructor(private readonly settings: z.infer<typeof openObserveSettings>) {}
  private logger: pino.Logger = null!;

  public logInfo(value: any) {
    this.createLogger().info(value);
  }
  public logWarn(value: any): void {
    this.createLogger().warn(value);
  }
  public logError(value: any): void {
    this.createLogger().error(value);
  }

  private createLogger() {
    if (this.logger) return this.logger;
    const settings = this.settings;
    const headers = OpenObserve.getHeaders(settings);
    settings.projectId = settings.projectId.replaceAll(" ", "_");
    const baseUrl = new URL(settings.baseUrl);
    const openObserveBaseUrl = `${baseUrl.protocol}//${baseUrl.host}`;
    const bulkInsertUrl = `${openObserveBaseUrl}/logs_${settings.projectId}/_multi`; // ND-JSON endpoint
    const transport = new HttpBufferedTransport({
      url: bulkInsertUrl,
      headers,
      bufferSize: 2 * 1024, // 4KB
      flushInterval: 1000, // 1s
    });
    const pinoLogger = pino(
      {
        timestamp: () => `,"_timestamp":"${new Date().toISOString()}"`,
        base: {
          route_id: settings.routeId,
          project_id: settings.projectId,
        },
        formatters: {
          level(label) {
            return { level: label };
          },
        },
      },
      transport,
    );
    return (this.logger = pinoLogger);
  }
  public static async TestConnection(
    settings: z.infer<typeof openObserveSettings>,
  ) {
    const headers = OpenObserve.getHeaders(settings);
    const settingsUrl = `${settings.baseUrl}/settings`;
    try {
      const result = await fetch(settingsUrl, { headers, method: "GET" });
      return result.status === 200;
    } catch {
      return false;
    }
  }
  public static extractConnectionInfo(
    config: {
      baseUrl: string;
      credentials: string | { username: string; password: string };
    },
    appConfig: ConfigType,
  ): z.infer<typeof openObserveSettings> | null {
    const baseUrl = config.baseUrl.startsWith("cfg:")
      ? OpenObserve.getConfig(appConfig, config.baseUrl.substring(3))
      : config.baseUrl;
    if (!baseUrl || !z.url().safeParse(baseUrl).success) return null;
    let credentials = config.credentials;
    if (typeof credentials === "object") {
      const username = credentials.username.startsWith("cfg:")
        ? OpenObserve.getConfig(appConfig, credentials.username.substring(3))
        : credentials.username;
      const password = credentials.password.startsWith("cfg:")
        ? OpenObserve.getConfig(appConfig, credentials.password.substring(3))
        : credentials.password;
      if (!username || !password) return null;
      credentials.password = password;
      credentials.username = username;
    } else {
      const encodedBasicAuth = credentials.startsWith("cfg:")
        ? OpenObserve.getConfig(appConfig, credentials.substring(3))
        : credentials;
      if (!encodedBasicAuth) return null;
      credentials = encodedBasicAuth;
    }

    return {
      baseUrl,
      credentials: typeof credentials === "object" ? credentials : undefined,
      projectId: "",
      routeId: "",
      encodedBasicAuth:
        typeof credentials === "string" ? credentials : undefined,
    };
  }
  private static getHeaders(
    settings: z.infer<typeof openObserveSettings>,
  ): Record<string, string> {
    if (settings.encodedBasicAuth) {
      return {
        Authorization: `Basic ${settings.encodedBasicAuth}`,
      };
    }
    if (
      !settings.credentials ||
      !settings.credentials.username ||
      !settings.credentials.password
    ) {
      console.error("[ERROR] [OPENOBSERVE] Credentials not found");
      return {};
    }
    const credentials = btoa(
      `${settings.credentials.username}:${settings.credentials.password}`,
    );
    return {
      Authorization: `Basic ${credentials}`,
    };
  }
  private static getConfig(cfg: ConfigType, key: string) {
    if (cfg instanceof Map) {
      return cfg.get(key);
    } else {
      return cfg[key];
    }
  }
}
