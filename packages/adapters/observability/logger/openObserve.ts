import { HttpBufferedTransport, PinoHttpProvider } from "@fluxify/lib";
import pino from "pino";
import z from "zod";
import { openObserveSettings } from "../openObserve";

export class OpenObserveLoggerProvider extends PinoHttpProvider {
  constructor(settings: z.infer<typeof openObserveSettings>) {
    const headers = getHeaders(settings);
    const bulkInsertUrl = `${settings.baseUrl}/logs_${settings.projectId}/_multi`; // ND-JSON endpoint
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
    super(pinoLogger);
  }
}

export async function testOpenObserveConnection(
  settings: z.infer<typeof openObserveSettings>,
) {
  const headers = getHeaders(settings);
  const settingsUrl = `${settings.baseUrl}/settings`;
  try {
    const result = await fetch(settingsUrl, { headers, method: "GET" });
    return result.status === 200;
  } catch {
    return false;
  }
}

function getHeaders(
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
