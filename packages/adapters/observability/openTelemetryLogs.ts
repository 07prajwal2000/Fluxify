import z from "zod";
import { AbstractLogger } from "@fluxify/lib";
import {
	createOtlpLoggerProvider,
	Logger,
	LoggerProvider,
	logger,
} from "@fluxify/common";
import { resolveCustomHeaders } from "./customHeaders";

export const openTelemetryLogsSettings = z.object({
	baseUrl: z.url(), // e.g. http://localhost:5080/api/<ORG_ID>
	credentials: z
		.object({
			username: z.string(),
			password: z.string(),
		})
		.optional(),
	encodedBasicAuth: z.string().optional(),
	/** user-supplied extra headers, already `cfg:`-resolved */
	headers: z.record(z.string(), z.string()).optional(),
	projectId: z.uuidv7(),
	routeId: z.uuidv7(),
});

type ConfigType = Map<string, string | number | boolean> | Record<string, any>;

export type OtlpSignal = "logs" | "traces" | "metrics";

/** An empty batch per signal — accepted and stored by nothing. */
const EMPTY_OTLP_BODY: Record<OtlpSignal, string> = {
	logs: '{"resourceLogs":[]}',
	traces: '{"resourceSpans":[]}',
	metrics: '{"resourceMetrics":[]}',
};

export class OpenTelemetryLogs implements AbstractLogger {
	// renamed from "Open Telemetry Logs" — one OTLP endpoint carries logs, traces
	// and metrics, and the old name only described the first of the three. Rows
	// still storing it are normalized before they reach here.
	public static variant = "Open Telemetry";
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

		// user headers first so they cannot clobber auth or the stream routing this
		// adapter depends on
		const headers = {
			...(settings.headers ?? {}),
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

	/**
	 * Probes the OTLP endpoint for one signal by posting an empty payload of that
	 * signal's shape. An empty batch ingests nothing and is answered 200 by a
	 * working receiver and 401 by one that rejects the credentials, so it tests
	 * the exact path telemetry will take — per signal, since a destination can be
	 * configured for traces but not metrics.
	 *
	 * Replaces a `GET {baseUrl}/settings` probe, which is an OpenObserve admin
	 * path: any other OTLP collector 404s it and read as unreachable.
	 */
	public static async TestConnection(
		settings: any,
		appConfig: ConfigType,
		signal: OtlpSignal = "logs",
	) {
		const extracted = OpenTelemetryLogs.ExtractConnectionInfo(
			settings,
			appConfig,
		);
		if (!extracted) return false;
		const headers = {
			...OpenTelemetryLogs.getHeaders(extracted),
			"Content-Type": "application/json",
		};
		const url = `${extracted.baseUrl.replace(/\/$/, "")}/v1/${signal}`;
		try {
			const result = await fetch(url, {
				method: "POST",
				headers,
				body: EMPTY_OTLP_BODY[signal],
				signal: AbortSignal.timeout(5000),
			});
			return result.ok;
		} catch {
			return false;
		}
	}

	public static ExtractConnectionInfo(
		config: {
			baseUrl: string;
			credentials: string | { username: string; password: string };
			headers?: Record<string, string>;
		},
		appConfig: ConfigType,
	): z.infer<typeof openTelemetryLogsSettings> | null {
		const baseUrl = config?.baseUrl?.startsWith("cfg:")
			? OpenTelemetryLogs.getConfig(appConfig, config.baseUrl.slice(4))
			: config.baseUrl;
		if (!baseUrl || !z.url().safeParse(baseUrl).success) return null;
		let credentials = config.credentials;
		if (typeof credentials === "object") {
			const username = credentials.username.startsWith("cfg:")
				? OpenTelemetryLogs.getConfig(
						appConfig,
						credentials.username.slice(4),
					)
				: credentials.username;
			const password = credentials.password.startsWith("cfg:")
				? OpenTelemetryLogs.getConfig(
						appConfig,
						credentials.password.slice(4),
					)
				: credentials.password;
			if (!username || !password) return null;
			credentials.password = password;
			credentials.username = username;
		} else {
			const encodedBasicAuth = credentials.startsWith("cfg:")
				? OpenTelemetryLogs.getConfig(appConfig, credentials.slice(4))
				: credentials;
			if (!encodedBasicAuth) return null;
			credentials = encodedBasicAuth;
		}

		return {
			baseUrl,
			credentials: typeof credentials === "object" ? credentials : undefined,
			headers: resolveCustomHeaders(config.headers, appConfig),
			projectId: "",
			routeId: "",
			encodedBasicAuth:
				typeof credentials === "string" ? credentials : undefined,
		};
	}
	private static getHeaders(
		settings: z.infer<typeof openTelemetryLogsSettings>,
	): Record<string, string> {
		const extra = settings.headers ?? {};
		if (settings.encodedBasicAuth) {
			return {
				...extra,
				Authorization: `Basic ${settings.encodedBasicAuth}`,
			};
		}
		if (
			!settings.credentials ||
			!settings.credentials.username ||
			!settings.credentials.password
		) {
			logger.error("Credentials not found", "opentelemetry");
			// no auth is a valid setup when the ingestor keys on a custom header
			return extra;
		}
		const credentials = btoa(
			`${settings.credentials.username}:${settings.credentials.password}`,
		);
		return {
			...extra,
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
