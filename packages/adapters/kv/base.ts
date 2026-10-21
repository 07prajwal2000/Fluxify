import type { KvAdapter } from "@fluxify/sdk/integrations";

export type { KvAdapter };

export abstract class BaseKVIntegration implements KvAdapter {
	abstract get(key: string): Promise<string | null>;
	abstract set(key: string, value: string): Promise<void>;
	abstract setex(key: string, seconds: number, value: string): Promise<void>;
	abstract delete(key: string): Promise<void>;
	abstract getConnection(): any;
}
