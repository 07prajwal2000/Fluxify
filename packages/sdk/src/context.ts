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

/** a database integration's adapter; `conditions` are Fluxify's where conditions */
export interface DbAdapter {
	getAll(
		table: string,
		conditions: object[],
		limit: number | null,
		offset: number,
		sort: { attribute: string; direction: "asc" | "desc" }[],
	): Promise<unknown[]>;
	getSingle(table: string, conditions: object[]): Promise<unknown | null>;
	count(table: string, conditions: object[]): Promise<number>;
	insert(table: string, data: unknown): Promise<any>;
	insertBulk(table: string, data: unknown[], useTransaction?: boolean): Promise<any>;
	update(
		table: string,
		data: unknown,
		conditions: object[],
	): Promise<{ count: number; affected: any[] }>;
	delete(table: string, conditions: object[]): Promise<{ count: number; affected: any[] }>;
	/** a native query (SQL with `$1` placeholders, or a MongoDB command) */
	raw(query?: string | unknown, params?: any[]): Promise<any>;
}

export interface KvAdapter {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	setex(key: string, seconds: number, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}

export interface QueueProducer {
	/** every message is answered; a throw means the broker could not be reached */
	send(
		messages: {
			/** topic, subject, queue URL, routing key or stream, in the connector's own terms */
			destination: string;
			payload: unknown;
			key?: string;
			headers?: Record<string, string>;
			options?: Record<string, unknown>;
		}[],
	): Promise<
		(
			| { index: number; ok: true; result: Record<string, unknown> }
			| { index: number; ok: false; error: string }
		)[]
	>;
	/** the connector's own client, connected */
	client(): Promise<unknown>;
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
