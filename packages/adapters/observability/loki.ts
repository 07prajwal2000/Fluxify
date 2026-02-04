import { AbstractLogger, HttpBufferedTransport } from "@fluxify/lib";
import pino from "pino";
import z from "zod";

export const lokiLoggerSettings = z.object({
  baseUrl: z.url(), // e.g. http://localhost:3100/loki/api/v1/push
  credentials: z
    .object({
      username: z.string().optional(),
      password: z.string().optional(),
    })
    .optional(),
  encodedBasicAuth: z.string().optional(),
  projectId: z.uuidv7(),
  routeId: z.uuidv7(),
});

type ConfigType = Map<string, string | number | boolean> | Record<string, any>;

export class LokiLogger implements AbstractLogger {
  constructor(private readonly settings: z.infer<typeof lokiLoggerSettings>) {}
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
  private static getHeader(
    settings: z.infer<typeof lokiLoggerSettings>,
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
      return {};
    }
    const credentials = btoa(
      `${settings.credentials.username}:${settings.credentials.password}`,
    );
    return {
      Authorization: `Basic ${credentials}`,
    };
  }
  private createLogger() {
    if (this.logger) return this.logger;
    const headers = LokiLogger.getHeader(this.settings);
    headers["Content-Type"] = "application/json";
    const baseUrl = new URL(this.settings.baseUrl);
    const lokiBaseUrl = `${baseUrl.protocol}//${baseUrl.host}/loki/api/v1/push`;
    const transport = new HttpBufferedTransport({
      url: lokiBaseUrl,
      headers,
      bufferSize: 2 * 1024, // 4KB
      flushInterval: 500, // 1s
      logStore: "loki",
      labels: {
        project_id: this.settings.projectId,
        route_id: this.settings.routeId,
        service_name: this.settings.routeId,
      },
    });
    return (this.logger = pino(
      {
        timestamp: () => new Date().toISOString(),
        base: {
          project_id: this.settings.projectId,
          route_id: this.settings.routeId,
        },
        formatters: {
          level(label) {
            return { level: label };
          },
        },
      },
      transport,
    ));
  }
  public static async TestConnection(
    settings: z.infer<typeof lokiLoggerSettings>,
  ): Promise<boolean> {
    try {
      const headers = LokiLogger.getHeader(settings);
      headers["Content-Type"] = "application/json";

      const baseUrl = new URL(settings.baseUrl);
      const lokiBaseUrl = `${baseUrl.protocol}//${baseUrl.host}`;

      // Test 1: Health check (no auth required)
      const healthUrl = `${lokiBaseUrl}/ready`;
      const healthRes = await fetch(healthUrl);

      if (!healthRes.ok) {
        return false;
      }

      // Test 2: Send test log to push endpoint (tests auth + push capability)
      const pushUrl = `${lokiBaseUrl}/loki/api/v1/push`;
      const testPayload = {
        streams: [
          {
            stream: {
              job: "connection-test",
            },
            values: [[(Date.now() * 1_000_000).toString(), "connection ok"]],
          },
        ],
      };

      const pushRes = await fetch(pushUrl, {
        headers, // ← Tests authentication here
        method: "POST",
        body: JSON.stringify(testPayload),
      });

      if (!pushRes.ok) {
        return false;
      }
      return true;
    } catch (err) {
      return false;
    }
  }
  public static extractConnectionInfo(
    config: {
      baseUrl: string;
      credentials: string | { username: string; password: string };
    },
    appConfig: ConfigType,
  ): z.infer<typeof lokiLoggerSettings> | null {
    const baseUrl = config.baseUrl.startsWith("cfg:")
      ? LokiLogger.getConfig(appConfig, config.baseUrl.substring(3))
      : config.baseUrl;
    if (!baseUrl || !z.url().safeParse(baseUrl).success) return null;
    let credentials = config.credentials;
    if (typeof credentials === "object") {
      const username = credentials.username.startsWith("cfg:")
        ? LokiLogger.getConfig(appConfig, credentials.username.substring(3))
        : credentials.username;
      const password = credentials.password.startsWith("cfg:")
        ? LokiLogger.getConfig(appConfig, credentials.password.substring(3))
        : credentials.password;
      credentials.password = password;
      credentials.username = username;
    } else {
      const encodedBasicAuth = credentials.startsWith("cfg:")
        ? LokiLogger.getConfig(appConfig, credentials.substring(3))
        : credentials;
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
  private static getConfig(cfg: ConfigType, key: string) {
    if (cfg instanceof Map) {
      return cfg.get(key);
    } else {
      return cfg[key];
    }
  }
}
