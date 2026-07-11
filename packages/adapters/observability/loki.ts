import { AbstractLogger } from "@fluxify/lib";
import pino from "pino";
import z from "zod";

export const lokiLoggerSettings = z.object({
	baseUrl: z.string().url(), // Fixed: Fixed invalid z.url() method call
	credentials: z
		.object({
			username: z.string().optional(),
			password: z.string().optional(),
		})
		.optional(),
	encodedBasicAuth: z.string().optional(),
	projectId: z.string().uuid().optional(), // Fixed: Swapped to uuid/optional to avoid empty string validation failure
	routeId: z.string().uuid().optional(),
});

type ConfigType = Map<string, string | number | boolean> | Record<string, any>;

export class LokiLogger implements AbstractLogger {
	public static variant = "Loki";
	private logger: pino.Logger = null!;

	constructor(private readonly settings: z.infer<typeof lokiLoggerSettings>) {}

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

		const baseUrl = new URL(this.settings.baseUrl);
		const host = `${baseUrl.protocol}//${baseUrl.host}`;

		let basicAuth = undefined;
		if (
			this.settings.credentials?.username &&
			this.settings.credentials?.password
		) {
			basicAuth = {
				username: this.settings.credentials.username,
				password: this.settings.credentials.password,
			};
		}

		const transport = pino.transport({
			target: "pino-loki",
			options: {
				host: host,
				basicAuth: basicAuth,
				labels: {
					project_id: this.settings.projectId ?? "unknown",
					route_id: this.settings.routeId ?? "unknown",
					service_name: this.settings.routeId ?? "unknown",
				},
				batching: true,
				interval: 500,
			},
		});

		return (this.logger = pino(
			{
				timestamp: pino.stdTimeFunctions.isoTime,
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
		settings: any,
		appConfig: ConfigType,
	): Promise<boolean> {
		try {
			const extracted = LokiLogger.extractConnectionInfo(settings, appConfig);
			if (!extracted) return false;
			const headers = LokiLogger.getHeader(extracted);

			const baseUrl = new URL(extracted.baseUrl);
			const lokiBaseUrl = `${baseUrl.protocol}//${baseUrl.host}`;

			// Test 1: Health check
			const healthUrl = `${lokiBaseUrl}/ready`;
			const healthRes = await fetch(healthUrl);

			if (!healthRes.ok) {
				return false;
			}

			// Test 2: Send test log to push endpoint
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
				headers: {
					"Content-Type": "application/json",
					...headers,
				},
				method: "POST",
				body: JSON.stringify(testPayload),
			});

			return pushRes.ok;
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

		if (!baseUrl || !z.string().url().safeParse(baseUrl).success) return null;

		let credentials = config.credentials;
		if (typeof credentials === "object") {
			const username = credentials.username.startsWith("cfg:")
				? LokiLogger.getConfig(appConfig, credentials.username.substring(3))
				: credentials.username;
			const password = credentials.password.startsWith("cfg:")
				? LokiLogger.getConfig(appConfig, credentials.password.substring(3))
				: credentials.password;
			credentials = { username, password };
		} else if (typeof credentials === "string") {
			const encodedBasicAuth = credentials.startsWith("cfg:")
				? LokiLogger.getConfig(appConfig, credentials.substring(3))
				: credentials;
			credentials = encodedBasicAuth;
		}

		return {
			baseUrl,
			credentials: typeof credentials === "object" ? credentials : undefined,
			projectId: undefined, // Safe initialization due to schema change
			routeId: undefined,
			encodedBasicAuth:
				typeof credentials === "string" ? credentials : undefined,
		};
	}

	private static getConfig(cfg: ConfigType, key: string): any {
		if (cfg instanceof Map) {
			return cfg.get(key);
		} else {
			return cfg[key];
		}
	}
}
