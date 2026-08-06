import { Redis, RedisOptions } from "ioredis";
import { BaseKVIntegration } from "./base";

export type RedisVariantConfig = {
	host?: string;
	port?: string | number;
	username?: string;
	password?: string;
	source: "credentials" | "url";
	url?: string;
};

export class RedisIntegration extends BaseKVIntegration {
	public static variant = "Redis";
	private client: Redis;

	constructor(private readonly config: RedisVariantConfig, isTestConnection: boolean = false) {
		super();
		const baseOptions: RedisOptions = {
			connectTimeout: 5000,
			...(isTestConnection ? { maxRetriesPerRequest: 0, retryStrategy: () => null } : {})
		};

		if (config.source === "url" && config.url) {
			this.client = new Redis(config.url, baseOptions);
		} else {
			const options: RedisOptions = {
				...baseOptions,
				host: config.host,
				port: typeof config.port === "string" ? parseInt(config.port, 10) : (config.port as number),
			};
			if (config.username) options.username = config.username;
			if (config.password) options.password = config.password;
			this.client = new Redis(options);
		}
	}

	async get(key: string): Promise<string | null> {
		return this.client.get(key);
	}

	async set(key: string, value: string): Promise<void> {
		await this.client.set(key, value);
	}

	async setex(key: string, seconds: number, value: string): Promise<void> {
		await this.client.setex(key, seconds, value);
	}

	async delete(key: string): Promise<void> {
		await this.client.del(key);
	}

	getConnection(): any {
		return this.client;
	}

	public async disconnect(): Promise<void> {
		this.client.disconnect();
	}

	static ExtractConnectionInfo(
		config: RedisVariantConfig,
		appConfigs: Map<string, string>,
	): RedisVariantConfig {
		const result = { ...config };
		if (result.source === "url" && result.url?.startsWith("cfg:")) {
			result.url = appConfigs.get(result.url.slice(4));
		} else {
			if (result.host?.startsWith("cfg:")) result.host = appConfigs.get(result.host.slice(4));
			if (typeof result.port === "string" && result.port.startsWith("cfg:")) result.port = appConfigs.get(result.port.slice(4));
			if (result.username?.startsWith("cfg:")) result.username = appConfigs.get(result.username.slice(4));
			if (result.password?.startsWith("cfg:")) result.password = appConfigs.get(result.password.slice(4));
		}
		return result;
	}

	static async TestConnection(
		config: RedisVariantConfig,
		appConfigs: Map<string, string>,
	): Promise<{ success: boolean; error?: string }> {
		let integration: RedisIntegration | null = null;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			const extractedConfig = this.ExtractConnectionInfo(config, appConfigs);
			integration = new RedisIntegration(extractedConfig, true);
			
			const pingPromise = integration.client.ping();
			const timeoutPromise = new Promise<never>((_, reject) => 
				timeout = setTimeout(() => reject(new Error("Connection timed out after 5 seconds")), 5000)
			);
			await Promise.race([pingPromise, timeoutPromise]);
			
			return { success: true };
		} catch (error: any) {
			return { success: false, error: error.message };
		} finally {
			if (timeout) clearTimeout(timeout);
			if (integration) {
				await integration.disconnect();
			}
		}
	}
}
