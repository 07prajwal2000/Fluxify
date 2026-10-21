/** The resolved config the loader caches for a `kv` integration. */
export type KvConnectionConfig = {
	variant?: string;
	host?: string;
	port?: string | number;
	username?: string;
	password?: string;
	database?: string | number;
	source: "credentials" | "url";
	url?: string;
};

/**
 * Key-Value adapter interface.
 * Built-in and plugin KV implementations satisfy this contract.
 */
export interface KvAdapter {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	setex(key: string, seconds: number, value: string): Promise<void>;
	delete(key: string): Promise<void>;
	getConnection?(): any;
}

export type IKvAdapter = KvAdapter;

/** Inspect/metadata shape for KV integrations. */
export type KvInspectResult = {
	keys?: string[];
};

export type KvMetadata = KvInspectResult;
