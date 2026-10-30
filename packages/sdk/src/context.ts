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
	BUILT_IN_VARIANT_ALIASES,
	BuiltInIntegrationAdapters,
	DbAdapter,
	KvAdapter,
	QueueProducer,
} from "./integrations/index.js";
import type { BuiltInVariantRaw } from "./integrations/raw.js";
import type { integrationBrand } from "./params.js";

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
		: K extends { group: "database"; adapter(...args: any[]): infer A; variant: string }
			? A
			: K extends { connect(config: any, ctx: any): infer R; variant: string; config: object }
				? Awaited<R>
				: K;

/**
 * An integration as `connection` hands it out: which variant it is (its name,
 * never an alias), the group's contract (what `get` returns) and the
 * variant's own client. Narrow on `variant` to reach a variant's `raw`.
 */
export type IntegrationConnection<V extends string = string, C = unknown, R = unknown> = {
	variant: V;
	client: C;
	/**
	 * The variant's own client (ioredis for Redis), undefined where it has none.
	 * A database's is its pool, outside any transaction a block started.
	 */
	raw: R;
};

type Groups = keyof BuiltInVariantRaw;
type Aliases = typeof BUILT_IN_VARIANT_ALIASES;
type Canonical<G, V> = G extends keyof Aliases
	? V extends keyof Aliases[G]
		? Aliases[G][V]
		: V
	: V;
/** one connection per variant listed; a name Fluxify does not ship is a plugin's, its `raw` unknown */
type BuiltInConnection<G extends Groups, V> = V extends string
	? Canonical<G, V> extends infer N extends keyof BuiltInVariantRaw[G] & string
		? IntegrationConnection<N, BuiltInIntegrationAdapters[G], BuiltInVariantRaw[G][N]>
		: IntegrationConnection<V, BuiltInIntegrationAdapters[G], unknown>
	: never;

/** a param of `kind` taking variants `V` (`never`: the kind's own variant, or the whole group) */
export type ConnectionFor<K extends string, V extends string = never> = K extends Groups
	? [V] extends [never]
		? // every variant Fluxify ships, and any a plugin adds
				| BuiltInConnection<K, keyof BuiltInVariantRaw[K]>
				| IntegrationConnection<string, BuiltInIntegrationAdapters[K], unknown>
		: BuiltInConnection<K, V>
	: K extends `${infer G extends Groups}/${infer KV}`
		? BuiltInConnection<G, [V] extends [never] ? KV : V>
		: IntegrationConnection<[V] extends [never] ? string : V>;

/** what `connection(id)` resolves to for a `param.integration` value; a plain string gives the loosest */
export type ConnectionOf<I> = I extends { readonly [integrationBrand]?: infer B }
	? NonNullable<B> extends { kind: infer K extends string; variants: infer V extends string }
		? ConnectionFor<K, V>
		: IntegrationConnection
	: IntegrationConnection;

/** `connection<typeof x>`: a plugin integration's, whose `raw` is what its `connect` returned */
export type PluginConnection<K extends PluginIntegrationLike> = IntegrationConnection<
	K["variant"],
	IntegrationClient<K>,
	Awaited<ReturnType<K["connect"]>>
>;
type PluginIntegrationLike = {
	connect(config: any, ctx: any): unknown;
	variant: string;
	config: object;
};

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
	/**
	 * `get`, with the integration's variant and its own client: typed from the
	 * param, so `variants: ["Redis"]` gives an ioredis `raw`, and several give a
	 * union to narrow on `variant`. `connection<typeof x>(id)` for a plugin's
	 * integration. Same grants and errors as `get`; `client` is what `get` returns.
	 */
	connection<I extends string>(id: I | undefined): Promise<ConnectionOf<I>>;
	connection<K extends PluginIntegrationLike>(id: string | undefined): Promise<PluginConnection<K>>;
}

export type PoolOptions<T> = {
	/** builds the client from `key` on first use (and again after it was closed or `key` changed) */
	create(key: any): T | Promise<T>;
	destroy?(client: T): unknown;
	/** unused time before the client closes; default 7.5 minutes, `0` keeps it until shutdown */
	idleMs?: number;
};

/**
 * Server-sent events to a route that called `sse.connect(id)`. The `handle`
 * (`<integrationId>:<id>`) is the route's `sse.connectionId`, passed to the
 * block, usually as a param; it names the route's broker, so these work from
 * any node, in a route or a workflow. A malformed handle throws
 * `not an SSE connection handle`.
 */
export interface SseContext {
	/** strings are sent as-is, anything else as JSON; multi-line data becomes one `data:` line per line */
	send(
		handle: string,
		data: unknown,
		options?: { event?: string; eventId?: string },
	): Promise<void>;
	/** ends the stream; safe to call twice */
	close(handle: string): Promise<void>;
	/**
	 * Aborts when the client left, or the stream was closed or taken over. Hand
	 * it to AI calls (`abortSignal`) so a stream nobody reads stops spending.
	 */
	signal(handle: string): AbortSignal;
}

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
	 * Aborts when the run is cancelled (the caller disconnected). Database and
	 * key-value adapters from this context already stop; hand it to your own
	 * slow work: `fetch(url, { signal: ctx.signal })`. Absent when nothing can
	 * cancel the run.
	 */
	signal?: AbortSignal;
	/** streams events to a connected route by its handle; see `SseContext` */
	sse: SseContext;
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
