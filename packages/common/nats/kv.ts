import { type KV, type KvEntry, Kvm } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core";
import { type Codec, jsonCodec } from "./codec";
import { isWrongLastSequence } from "./errors";
import { type KvWatcher, type KvWatchOptions, startWatch } from "./kvWatch";

export type { KvWatcher, KvWatchOptions };

/**
 * Typed wrapper over a NATS KV bucket.
 *
 * KV is a JetStream stream underneath, which is what makes `watch` possible:
 * a process subscribes to a key filter and every update is pushed to it. That
 * is the whole reason config lives here rather than on a fire-and-forget
 * channel — a watcher gets the current value on connect and converges after a
 * disconnect, instead of missing one notification and serving a stale value
 * until something else happens to reload it.
 */

export interface KvBucketOptions {
	/** Revisions kept per key. 1 (default) means only the current value. */
	history?: number;
	/** Per-key expiry. Omit for values that live until deleted. */
	ttlMs?: number;
	/** Replicas in a clustered NATS. */
	replicas?: number;
}

export interface KvBucket<T> {
	readonly name: string;
	/** The decoded value, or null when absent or deleted. */
	get(key: string): Promise<T | null>;
	/** Writes and returns the new revision. */
	put(key: string, value: T): Promise<number>;
	/**
	 * Writes only if the key does not currently hold a value, returning the new
	 * revision — or null when someone else got there first. This is the
	 * put-if-absent primitive; the check and the write are one server-side
	 * operation, so two racing processes cannot both win.
	 */
	create(key: string, value: T): Promise<number | null>;
	/**
	 * Writes only if the key is still at `revision`, returning the new one — or
	 * null when someone else wrote first. For a lease: a holder that renews with
	 * a plain `put` would take back a lease that already expired and was handed
	 * to someone else, because a blind write does not care what it overwrites.
	 */
	update(key: string, value: T, revision: number): Promise<number | null>;
	/**
	 * Deletes the key. With `revision`, only while the key is still at it: a key
	 * someone has since written to is left alone, which is a normal outcome.
	 */
	delete(key: string, revision?: number): Promise<void>;
	keys(filter?: string | string[]): Promise<string[]>;
	/**
	 * Calls `onChange` with the current value of every matching key, then with
	 * every subsequent change. A delete arrives as a null value. `entry` carries
	 * the broker's revision and creation time; a key found gone on a reconnect
	 * has none.
	 */
	watch(
		filter: string | string[],
		onChange: (key: string, value: T | null, entry?: KvEntry) => void | Promise<void>,
		options?: KvWatchOptions,
	): Promise<KvWatcher>;
	/** The underlying store, for anything this wrapper does not cover. */
	readonly store: KV;
}

/** Opens the bucket, creating it when missing. */
export async function openKvBucket<T = unknown>(
	nc: NatsConnection,
	name: string,
	options: KvBucketOptions & { codec?: Codec<T> } = {},
): Promise<KvBucket<T>> {
	const codec = options.codec ?? jsonCodec<T>();
	const store = await new Kvm(nc).create(name, {
		history: options.history ?? 1,
		...(options.ttlMs !== undefined ? { ttl: options.ttlMs } : {}),
		...(options.replicas !== undefined ? { replicas: options.replicas } : {}),
	});

	function decode(entry: KvEntry | null): T | null {
		if (!entry || entry.operation !== "PUT") return null;
		return codec.decode(entry.value);
	}

	return {
		name,
		store,

		async get(key) {
			return decode(await store.get(key));
		},

		async put(key, value) {
			return store.put(key, codec.encode(value));
		},

		async create(key, value) {
			try {
				return await store.create(key, codec.encode(value));
			} catch (error) {
				// the key already holds a value — the loser of the race, which is a
				// normal outcome here rather than a failure
				if (isWrongLastSequence(error)) return null;
				throw error;
			}
		},

		async update(key, value, revision) {
			try {
				return await store.update(key, codec.encode(value), revision);
			} catch (error) {
				// someone else wrote since `revision` — for a lease holder this means
				// the lease is no longer ours, which is a normal outcome to handle
				// rather than a failure to throw
				if (isWrongLastSequence(error)) return null;
				throw error;
			}
		},

		async delete(key, revision) {
			try {
				await store.delete(key, revision === undefined ? undefined : { previousSeq: revision });
			} catch (error) {
				if (revision === undefined || !isWrongLastSequence(error)) throw error;
			}
		},

		async keys(filter: string | string[] = ">") {
			const found: string[] = [];
			for await (const key of await store.keys(filter)) found.push(key);
			return found;
		},

		async watch(filter, onChange, watchOptions = {}) {
			return startWatch(nc, store, name, filter, onChange, decode, watchOptions);
		},
	};
}
