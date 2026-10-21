export {
	type Connection,
	DbType,
	DEFAULT_MAX_CONNECTIONS,
	DEFAULT_QUERY_TIMEOUT_MS,
	type IsolationLevel,
	isolationClause,
	MAX_MAX_CONNECTIONS,
} from "@fluxify/sdk/integrations";

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
