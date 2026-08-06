import Memcached from "memcached";
import { BaseKVIntegration } from "./base";

export type MemcachedVariantConfig = {
	host?: string;
	port?: string | number;
	username?: string;
	password?: string;
	source: "credentials" | "url";
	url?: string;
};

export class MemcachedIntegration extends BaseKVIntegration {
	public static variant = "Memcached";
	private client: Memcached;

	constructor(private readonly config: MemcachedVariantConfig, isTestConnection: boolean = false) {
		super();
		const options = isTestConnection ? { timeout: 5000, retries: 0 } : {};
		if (config.source === "url" && config.url) {
			this.client = new Memcached(config.url, options);
		} else {
			const address = `${config.host}:${config.port}`;
			this.client = new Memcached(address, options);
		}
	}

	async get(key: string): Promise<string | null> {
		return new Promise((resolve, reject) => {
			this.client.get(key, (err, data) => {
				if (err) reject(err);
				else resolve(data ? data.toString() : null);
			});
		});
	}

	async set(key: string, value: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.client.set(key, value, 0, (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}

	async setex(key: string, seconds: number, value: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.client.set(key, value, seconds, (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}

	async delete(key: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.client.del(key, (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}

	getConnection(): any {
		return this.client;
	}

	public async disconnect(): Promise<void> {
		this.client.end();
	}

	static ExtractConnectionInfo(
		config: MemcachedVariantConfig,
		appConfigs: Map<string, string>,
	): MemcachedVariantConfig {
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
		config: MemcachedVariantConfig,
		appConfigs: Map<string, string>,
	): Promise<{ success: boolean; error?: string }> {
		let integration: MemcachedIntegration | null = null;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			const extractedConfig = this.ExtractConnectionInfo(config, appConfigs);
			integration = new MemcachedIntegration(extractedConfig, true);
			
			const pingPromise = integration.set("test_ping", "1");
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
