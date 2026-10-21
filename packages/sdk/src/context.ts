/**
 * What a block's `run` gets as `ctx`. Plain structural types: the engine's own
 * context is checked against them at compile time (`packages/blocks`), so a
 * field here is one the runtime really passes.
 */

type Headers = Record<string, string>;
type HttpResponse<T> = { data: T; status: number; headers: Record<string, unknown> };

export interface HttpClient {
	get<T = any>(url: string, headers?: Headers): Promise<HttpResponse<T>>;
	post<T = any>(url: string, data?: any, headers?: Headers): Promise<HttpResponse<T>>;
	put<T = any>(url: string, data?: any, headers?: Headers): Promise<HttpResponse<T>>;
	delete<T = any>(url: string, headers?: Headers): Promise<HttpResponse<T>>;
	patch<T = any>(url: string, data?: any, headers?: Headers): Promise<HttpResponse<T>>;
}

export interface Logger {
	logInfo(value: any): void;
	logWarn(value: any): void;
	logError(value: any): void;
}

/** the request helpers every block sees, as in the JS Runner */
export interface BlockVars {
	logger: Logger;
	httpClient: HttpClient;
	httpRequestMethod: string;
	httpRequestRoute: string;
	getQueryParam(key: string): string | undefined;
	getRouteParam(key: string): string;
	getHeader(key: string): string;
	setHeader(key: string, value: string): void;
	getCookie(key: string): string;
	getRequestBody(): any;
	/** an app config value; needs `permissions.appconfig` */
	getConfig(key: string): string | number | boolean;
	[key: string]: any;
}

export type {
	DatabaseAdapter,
	DbAdapter,
	KvAdapter,
	QueueProducer,
} from "./integrations/index.js";

import type {
	BuiltInIntegrationAdapters,
	DbAdapter,
	KvAdapter,
	QueueProducer,
} from "./integrations/index.js";

/**
 * What `ctx.integrations.get<K>` resolves to: a built-in group name gives that
 * group's adapter (`"database"` is a `DatabaseAdapter`); `typeof` an
 * `integration(...)` gives what its `connect` hands out; any other type is the
 * client a plugin's own integration hands out and passes through unchanged.
 */
export type IntegrationClient<K> = K extends keyof BuiltInIntegrationAdapters
	? BuiltInIntegrationAdapters[K]
	: K extends string
		? unknown
		: K extends { connect(config: any, ctx: any): infer R; variant: string; config: object }
			? Awaited<R>
			: K;

/**
 * The integrations a block was granted (`permissions.integrations`), by id: the
 * value of a `param.integration` param. The same integration is the same client
 * all through one request, and inside a database transaction `get<"database">`
 * is the transaction's client, so a block there takes part in it.
 */
export interface IntegrationsContext {
	/**
	 * `id` is a `param.integration` value, which is undefined while the canvas left it empty.
	 * Throws when the block was not granted the integration's kind, or when the
	 * id is unknown, has no value in this environment, or belongs to another project.
	 */
	get<K = unknown>(id: string | undefined): Promise<IntegrationClient<K>>;
}

export type PoolOptions<T> = {
	/** builds the client from `key` on first use (and again after it was closed or `key` changed) */
	create(key: any): T | Promise<T>;
	destroy?(client: T): unknown;
	/** unused time before the client closes; default 7.5 minutes, `0` keeps it until shutdown */
	idleMs?: number;
};

export interface BlockContext {
	projectId: string;
	route: string;
	apiId: string;
	/** request helpers, the logger and the HTTP client */
	vars: BlockVars;
	/** the integrations this block was granted, by id */
	integrations: IntegrationsContext;
	/** `getDbAdapter(<integration id>)`: a database integration (an `integration` param's value) */
	dbFactory?: { getDbAdapter(connection: string): DbAdapter };
	/** `getKvAdapter(<integration id>)`: a key-value integration */
	kvFactory?: { getKvAdapter(connection: string): KvAdapter };
	/** `getProducer(<integration id>)`: a message queue integration */
	queueFactory?: { getProducer(connection: string): Promise<QueueProducer> };
	httpClient?: HttpClient;
	/**
	 * Times `fn` as a child span of this block in the run's trace; outcome and
	 * error come from whether it threw (the error is rethrown). Spans opened
	 * inside `fn` nest under it.
	 */
	span<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
	/**
	 * A client kept across requests (one per project, block, `kind` and `key`),
	 * closed after `idleMs` unused and on shutdown. It is never closed while a
	 * `run` that asked for it is still going.
	 *
	 * A pooled client must not be used from a late `executeHandle` call (one
	 * made after `run` returned): that call holds no lease, so the client can
	 * close under it. Call `ctx.pool` again inside the late call instead.
	 */
	pool<T>(kind: string, key: unknown, options: PoolOptions<T>): Promise<T>;
}
