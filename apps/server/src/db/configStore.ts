import { logger } from "@fluxify/common";
import { openKvBucket, type KvBucket, type KvWatcher } from "@fluxify/common/nats";
import type { ZodType, z } from "zod";
import { initializeNats } from "./nats";

/**
 * Cross-node config distribution over NATS KV.
 *
 * Postgres stays the write path and the source of truth; this is the layer that
 * gets a value from the process that wrote it to every process that reads it.
 * Redis pub/sub used to do that job and is fire-and-forget: a process that was
 * restarting when the notification went out never learned about it and served a
 * stale value until something else happened to reload. A KV watch replays the
 * current value on connect and pushes every change afterwards, so a process
 * that missed one converges instead of diverging.
 *
 * It is deliberately narrow — small, slow-changing, schema-validated config.
 * It is not a cache and must not grow into one.
 *
 * Adding a consumer means writing a registry and calling `createConfigStore`.
 * If it means editing this file, this file is wrong.
 */

/** One shared bucket, one prefix per consumer — a fresh install provisions one thing. */
export const CONFIG_BUCKET = "fluxify_config";

export interface ConfigRegistryEntry {
	/** Full schema. May describe secrets; only ever decoded in-process. */
	schema: ZodType;
	/** Projection handed to unauthenticated callers, with secrets stripped. */
	publicSchema: ZodType;
}

export type ConfigRegistry = Record<string, ConfigRegistryEntry>;

export type ConfigKey<R extends ConfigRegistry> = keyof R & string;
export type ConfigValue<R extends ConfigRegistry, K extends ConfigKey<R>> = z.infer<
	R[K]["schema"]
>;

/** What a value looks like on the wire: the value plus its visibility. */
interface ConfigEnvelope {
	value: unknown;
	isPublic: boolean;
}

/** A row from the authoritative store, for boot reconciliation. */
export interface ConfigRow {
	key: string;
	value: unknown;
	isPublic: boolean;
}

export interface ConfigStoreStartOptions {
	/**
	 * Reads the authoritative rows, used once at boot to reconcile them into KV.
	 * Only the process that owns the database passes this — a worker starts
	 * without it and is fed entirely by the watch, which is what keeps workers
	 * off Postgres.
	 */
	reconcile?: () => Promise<ConfigRow[]>;
	/**
	 * Fired after a change arrives, never during the initial replay. For work
	 * that has to happen when config moves, like rebuilding a client from it.
	 */
	onChange?: (key: string) => void | Promise<void>;
}

export interface ConfigStore<R extends ConfigRegistry> {
	start(options?: ConfigStoreStartOptions): Promise<void>;
	/** The current value, or null when unset or invalid. */
	get<K extends ConfigKey<R>>(key: K): ConfigValue<R, K> | null;
	/** Every public key, projected through its `publicSchema`. */
	getPublic(): Record<string, unknown>;
	/** Publishes a value to every watcher. Call after the authoritative write. */
	put(key: ConfigKey<R>, value: unknown, isPublic: boolean): Promise<void>;
	stop(): Promise<void>;
}

export function createConfigStore<R extends ConfigRegistry>(config: {
	/** Key namespace inside the shared bucket, e.g. `instance_settings`. */
	prefix: string;
	registry: R;
}): ConfigStore<R> {
	const { prefix, registry } = config;
	const cache = new Map<string, ConfigEnvelope>();
	const kvKey = (key: string) => `${prefix}.${key}`;

	let bucket: KvBucket<ConfigEnvelope> | null = null;
	let watcher: KvWatcher | null = null;

	function store(): KvBucket<ConfigEnvelope> {
		if (!bucket) throw new Error(`config store '${prefix}' used before start()`);
		return bucket;
	}

	/** Validates against the registry; an unknown or malformed key is dropped. */
	function accept(key: string, envelope: ConfigEnvelope | null): boolean {
		const entry = registry[key];
		if (!entry) return false; // key this build does not know about
		if (!envelope) {
			cache.delete(key);
			return true;
		}
		const parsed = entry.schema.safeParse(envelope.value);
		if (!parsed.success) {
			logger.warn(`[config] ${prefix}.${key} failed validation, ignoring`);
			return false;
		}
		cache.set(key, { value: parsed.data, isPublic: envelope.isPublic });
		return true;
	}

	return {
		async start({ reconcile, onChange }: ConfigStoreStartOptions = {}) {
			const nc = await initializeNats();
			bucket = await openKvBucket<ConfigEnvelope>(nc, CONFIG_BUCKET, {
				history: 1,
			});

			// Postgres wins on boot: every admin restart rebuilds this prefix so a
			// wiped KV volume, a restored database, or a key deleted behind the
			// bus all converge instead of diverging silently.
			//
			// Rebuild is write-over-then-prune rather than delete-all-then-write.
			// The end state is identical — the prefix is exactly what Postgres
			// says — but clearing first would publish a null for every key and
			// leave every worker in the cluster briefly holding no config at all,
			// mid-restart, which is precisely when it can least afford to.
			if (reconcile) {
				const rows = await reconcile();
				const live = new Set<string>();
				for (const row of rows) {
					if (!registry[row.key]) continue; // key this build does not know
					live.add(kvKey(row.key));
					await store().put(kvKey(row.key), {
						value: row.value,
						isPublic: row.isPublic,
					});
				}
				for (const key of await store().keys(`${prefix}.>`)) {
					if (!live.has(key)) await store().delete(key);
				}
			}

			let replaying = true;
			watcher = await store().watch(
				`${prefix}.>`,
				async (key, envelope) => {
					const name = key.slice(prefix.length + 1);
					if (!accept(name, envelope)) return;
					if (!replaying) await onChange?.(name);
				},
				{ includeExisting: true },
			);
			await watcher.initialized;
			replaying = false;
		},

		get(key) {
			return (cache.get(key)?.value ?? null) as ConfigValue<R, typeof key> | null;
		},

		getPublic() {
			const out: Record<string, unknown> = {};
			for (const [key, entry] of cache) {
				if (!entry.isPublic) continue;
				out[key] = registry[key]!.publicSchema.parse(entry.value);
			}
			return out;
		},

		async put(key, value, isPublic) {
			await store().put(kvKey(key), { value, isPublic });
		},

		async stop() {
			await watcher?.stop();
			watcher = null;
		},
	};
}
