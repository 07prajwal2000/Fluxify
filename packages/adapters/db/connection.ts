export enum DbType {
	POSTGRES = "pg",
	MONGODB = "mongo",
	MYSQL = "mysql",
}

export interface Connection {
	dbType: DbType;
	username: string;
	password: string;
	host: string;
	port: string | number;
	database: string;
	ssl?: boolean;
	/** a query running longer is stopped; unset means DEFAULT_QUERY_TIMEOUT_MS */
	queryTimeoutMs?: number;
	/** most connections the pool opens, per worker; unset means DEFAULT_MAX_CONNECTIONS */
	maxConnections?: number;
}

export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_CONNECTIONS: Record<DbType, number> = {
	[DbType.POSTGRES]: 10,
	[DbType.MYSQL]: 10,
	[DbType.MONGODB]: 100,
};

const primaryKeyCaches = new WeakMap<object, Map<string, string[]>>();

/**
 * A table's primary key, kept per pool rather than per adapter: an adapter lives for one
 * request, so a cache on it re-ran the lookup on every request (#408). The pool lives until
 * its integration changes or it idles out, and the cache goes with it. "No key" (a view, a
 * table not created yet) is kept only for the request, in `keyless`, so a key added later is found.
 * ponytail: a key changed while the pool is open is seen only once the pool is replaced
 */
export async function cachedPrimaryKey(
	pool: object,
	keyless: Set<string>,
	table: string,
	lookup: () => Promise<string[]>,
): Promise<string[]> {
	let cache = primaryKeyCaches.get(pool);
	if (!cache) {
		cache = new Map();
		primaryKeyCaches.set(pool, cache);
	}
	const known = cache.get(table) ?? (keyless.has(table) ? [] : undefined);
	if (known) return known;
	const pk = await lookup();
	if (pk.length) cache.set(table, pk);
	else keyless.add(table);
	return pk;
}

export type IsolationLevel = "read_committed" | "repeatable_read" | "serializable";

/** " ISOLATION LEVEL ..." for BEGIN / SET TRANSACTION, "" for the database default */
export function isolationClause(isolation?: IsolationLevel) {
	return isolation ? ` ISOLATION LEVEL ${isolation.replace("_", " ").toUpperCase()}` : "";
}
