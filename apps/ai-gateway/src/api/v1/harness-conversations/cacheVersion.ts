import { getCache, incrCache } from "@fluxify/server";

/**
 * The list cache is invalidated by version bump (O(1) INCR) instead of a
 * pattern-scan delete (`deleteCacheKeysByPattern`, which runs Redis KEYS — an
 * O(N) scan over the whole keyspace that blocks Redis while it runs). Stale
 * entries from a prior version are simply orphaned and expire via their own
 * TTL (see list/service.ts), so there's no unbounded growth.
 */
function versionKey(userId: string): string {
	return `harness-conversations:list:version:${userId}`;
}

export async function getListCacheVersion(userId: string): Promise<string> {
	const version = await getCache(versionKey(userId));
	return version || "0";
}

export async function bumpListCacheVersion(userId: string): Promise<void> {
	await incrCache(versionKey(userId));
}
