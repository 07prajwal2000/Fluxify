/**
 * What a plugin may weigh. Every source shares them, because every source ends
 * in the same unpacked file set. ponytail: fixed guesses at a generous plugin
 * (a few hundred KB of built JS and a lockfile); make them settings if a real
 * plugin outgrows one.
 */

/** the compressed tarball, as uploaded or downloaded */
export const MAX_TARBALL_BYTES = 25 * 1024 * 1024;
/** everything unpacked, tar headers included: the zip-bomb guard */
export const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
/** files and folders in one plugin */
export const MAX_ENTRIES = 2_000;
/** how long a source waits on a registry, a CDN or a tarball host */
export const FETCH_TIMEOUT_MS = 30_000;
