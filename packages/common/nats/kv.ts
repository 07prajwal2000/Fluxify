import { Kvm, KvWatchInclude, type KV, type KvEntry } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core";
import { logger } from "../logging";
import { type Codec, jsonCodec } from "./codec";
import { isWrongLastSequence } from "./errors";

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

export interface KvWatchOptions {
	/**
	 * Replay the current value of every matching key before streaming updates.
	 * Default true — a watcher that only sees future writes starts out blind to
	 * everything already stored.
	 */
	includeExisting?: boolean;
}

export interface KvWatcher {
	/**
	 * Resolves once every pre-existing value has been handed to `onChange`, so a
	 * caller can await a complete picture before serving traffic.
	 */
	initialized: Promise<void>;
	stop(): Promise<void>;
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
	delete(key: string): Promise<void>;
	keys(filter?: string): Promise<string[]>;
	/**
	 * Calls `onChange` with the current value of every matching key, then with
	 * every subsequent change. A delete arrives as a null value.
	 */
	watch(
		filter: string,
		onChange: (key: string, value: T | null) => void | Promise<void>,
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

		async delete(key) {
			await store.delete(key);
		},

		async keys(filter = ">") {
			const found: string[] = [];
			for await (const key of await store.keys(filter)) found.push(key);
			return found;
		},

		async watch(filter, onChange, watchOptions = {}) {
			return startWatch(store, name, filter, onChange, decode, watchOptions);
		},
	};
}

/**
 * Replay-then-updates, done deterministically.
 *
 * The v2 client took an `initializedFn` callback; v3 replaced it with an
 * `isUpdate` flag on each entry, which cannot answer "the replay is finished"
 * when the replay is empty — no entry ever arrives to carry the flag. So the
 * order here is inverted: start an updates-only watch first and buffer what it
 * yields, read the current values second, then flush. Nothing can slip through
 * the gap, because there is no gap.
 *
 * A buffered update can be older than the value the snapshot read, so revisions
 * are tracked per key and a lower one is discarded rather than applied on top.
 */
async function startWatch<T>(
	store: KV,
	bucket: string,
	filter: string,
	onChange: (key: string, value: T | null) => void | Promise<void>,
	decode: (entry: KvEntry | null) => T | null,
	{ includeExisting = true }: KvWatchOptions,
): Promise<KvWatcher> {
	const iterator = await store.watch({
		key: filter,
		include: KvWatchInclude.UpdatesOnly,
	});

	const revisions = new Map<string, number>();
	let buffer: KvEntry[] | null = includeExisting ? [] : null;

	async function apply(entry: KvEntry) {
		const seen = revisions.get(entry.key);
		if (seen !== undefined && seen >= entry.revision) return;
		revisions.set(entry.key, entry.revision);
		await onChange(entry.key, decode(entry));
	}

	void (async () => {
		try {
			for await (const entry of iterator) {
				if (buffer) buffer.push(entry);
				else await apply(entry);
			}
		} catch (error) {
			logger.error(`[nats] kv watch ${bucket}/${filter} ended: ${String(error)}`, "NATS");
		}
	})();

	async function replay() {
		if (!buffer) return;
		for await (const key of await store.keys(filter)) {
			const entry = await store.get(key);
			if (entry) await apply(entry);
		}
		const pending = buffer;
		buffer = null;
		for (const entry of pending) await apply(entry);
	}

	return {
		initialized: replay(),
		stop: async () => {
			await iterator.stop();
		},
	};
}
