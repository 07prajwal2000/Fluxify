import z from "zod";
import { AbstractLogger } from "@fluxify/lib";
import {
	createOtlpLoggerProvider,
	Logger,
	LoggerProvider,
	logger,
} from "@fluxify/common";

export const openTelemetryLogsSettings = z.object({
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

export class OpenTelemetryLogs implements AbstractLogger {
	public static variant = "Open Telemetry Logs";
	constructor(
		private readonly settings: z.infer<typeof openTelemetryLogsSettings>,
	) {}
	private otelLogger: Logger = null!;
	private loggerProvider: LoggerProvider = null!;

	public logInfo(value: any, ...extra: any) {
		this.emitLog(9, "INFO", value, extra);
	}
	public logWarn(value: any, ...extra: any) {
		this.emitLog(13, "WARN", value, extra);
	}
	public logError(value: any, ...extra: any) {
		this.emitLog(17, "ERROR", value, extra);
	}

	private emitLog(
		severityNumber: number,
		severityText: string,
		value: any,
		extra: any[],
	) {
		const logger = this.createLogger();
		const extraData =
			extra.length === 1 ? extra[0] : extra.length > 1 ? extra : undefined;

		const attributes: Record<string, string> = {
			route_id: this.settings.routeId,
			project_id: this.settings.projectId,
		};

		let messageStr = "";
		if (typeof value === "string") {
			messageStr = value;
		} else if (value instanceof Error) {
			messageStr = value.stack || value.message;
		} else {
			messageStr = JSON.stringify(value);
		}

		attributes.message = messageStr;

		if (extraData !== undefined) {
			attributes.extra =
				typeof extraData === "string" ? extraData : JSON.stringify(extraData);
		}

		logger.emit({
			severityNumber,
			severityText,
			body: messageStr,
			attributes,
		});

		// Start flush to ensure logs are not lost in short-lived test processes
		if (
			this.loggerProvider &&
			typeof this.loggerProvider.forceFlush === "function"
		) {
			this.loggerProvider.forceFlush().catch(() => {});
		}
	}

	private createLogger() {
		if (this.otelLogger) return this.otelLogger;
		const settings = this.settings;

		let credentialsString = "";
		if (settings.encodedBasicAuth) {
			credentialsString = settings.encodedBasicAuth;
		} else if (
			settings.credentials?.username &&
			settings.credentials?.password
		) {
			credentialsString = btoa(
				`${settings.credentials.username}:${settings.credentials.password}`,
			);
		}

		let cleanUrl = settings.baseUrl.replace(/\/$/, "");
		if (!cleanUrl.endsWith("/v1/logs")) {
			cleanUrl = `${cleanUrl}/v1/logs`;
		}

		const headers = {
			Authorization: `Basic ${credentialsString}`,
			"stream-name": `logs_${settings.projectId}`,
		};

		this.loggerProvider = createOtlpLoggerProvider({
			url: cleanUrl,
			headers,
			serviceName: "fluxify.server",
		});

		// Call getLogger directly on our local provider to avoid global collisions!
		this.otelLogger = this.loggerProvider.getLogger(
			"fluxify-opentelemetry-logger",
		);
		return this.otelLogger;
	}

	public static async TestConnection(settings: any, appConfig: ConfigType) {
		const extracted = OpenTelemetryLogs.ExtractConnectionInfo(
			settings,
			appConfig,
		);
		if (!extracted) return false;
		const headers = OpenTelemetryLogs.getHeaders(extracted);
		const settingsUrl = `${extracted.baseUrl}/settings`;
		try {
			const result = await fetch(settingsUrl, { headers, method: "GET" });
			return result.status === 200;
		} catch {
			return false;
		}
	}

	public static ExtractConnectionInfo(
		config: {
			baseUrl: string;
			credentials: string | { username: string; password: string };
		},
		appConfig: ConfigType,
	): z.infer<typeof openTelemetryLogsSettings> | null {
		const baseUrl = config?.baseUrl?.startsWith("cfg:")
			? OpenTelemetryLogs.getConfig(appConfig, config.baseUrl.substring(3))
			: config.baseUrl;
		if (!baseUrl || !z.url().safeParse(baseUrl).success) return null;
		let credentials = config.credentials;
		if (typeof credentials === "object") {
			const username = credentials.username.startsWith("cfg:")
				? OpenTelemetryLogs.getConfig(
						appConfig,
						credentials.username.substring(3),
					)
				: credentials.username;
			const password = credentials.password.startsWith("cfg:")
				? OpenTelemetryLogs.getConfig(
						appConfig,
						credentials.password.substring(3),
					)
				: credentials.password;
			if (!username || !password) return null;
			credentials.password = password;
			credentials.username = username;
		} else {
			const encodedBasicAuth = credentials.startsWith("cfg:")
				? OpenTelemetryLogs.getConfig(appConfig, credentials.substring(3))
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
		settings: z.infer<typeof openTelemetryLogsSettings>,
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
			logger.error("Credentials not found", "opentelemetry");
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
