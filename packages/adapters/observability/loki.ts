import { AbstractLogger } from "@fluxify/lib";
import { createLokiLogger } from "@fluxify/common";
import { resolveCustomHeaders } from "./customHeaders";
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
	/** user-supplied extra headers, already `cfg:`-resolved */
	headers: z.record(z.string(), z.string()).optional(),
	projectId: z.string().uuid().optional(), // Fixed: Swapped to uuid/optional to avoid empty string validation failure
	routeId: z.string().uuid().optional(),
});

type ConfigType = Map<string, string | number | boolean> | Record<string, any>;

export class LokiLogger implements AbstractLogger {
	public static variant = "Loki";
	private logger: ReturnType<typeof createLokiLogger> = null!;

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
		// user headers first so they cannot clobber auth
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
			// Loki is commonly run unauthenticated, and a tenant is often supplied as
			// a header instead — so no credentials still means send the extras
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

	private createLogger() {
		if (this.logger) return this.logger;

		const baseUrl = new URL(this.settings.baseUrl);
		const host = `${baseUrl.protocol}//${baseUrl.host}`;

		const basicAuth = this.settings.credentials?.username && this.settings.credentials?.password 
			? `${this.settings.credentials.username}:${this.settings.credentials.password}`
			: undefined;

		return (this.logger = createLokiLogger({
			host: host,
			basicAuth: basicAuth,
			labels: {
				project_id: this.settings.projectId ?? "unknown",
				route_id: this.settings.routeId ?? "unknown",
				service_name: this.settings.routeId ?? "unknown",
			},
		}));
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
			headers?: Record<string, string>;
		},
		appConfig: ConfigType,
	): z.infer<typeof lokiLoggerSettings> | null {
		const baseUrl = config.baseUrl.startsWith("cfg:")
			? LokiLogger.getConfig(appConfig, config.baseUrl.slice(4))
			: config.baseUrl;

		if (!baseUrl || !z.string().url().safeParse(baseUrl).success) return null;

		let credentials = config.credentials;
		if (typeof credentials === "object") {
			const username = credentials.username.startsWith("cfg:")
				? LokiLogger.getConfig(appConfig, credentials.username.slice(4))
				: credentials.username;
			const password = credentials.password.startsWith("cfg:")
				? LokiLogger.getConfig(appConfig, credentials.password.slice(4))
				: credentials.password;
			credentials = { username, password };
		} else if (typeof credentials === "string") {
			const encodedBasicAuth = credentials.startsWith("cfg:")
				? LokiLogger.getConfig(appConfig, credentials.slice(4))
				: credentials;
			credentials = encodedBasicAuth;
		}

		return {
			baseUrl,
			credentials: typeof credentials === "object" ? credentials : undefined,
			headers: resolveCustomHeaders(config.headers, appConfig),
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
