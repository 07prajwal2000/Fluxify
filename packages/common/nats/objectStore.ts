import type { NatsConnection } from "@nats-io/nats-core";
import { Objm } from "@nats-io/obj";

/**
 * Typed wrapper over a NATS Object Store bucket: whole blobs under a string key,
 * chunked by JetStream so a value is not capped by the server's `max_payload`
 * the way a KV value is. For files (a plugin tarball), not for state: use `kv`
 * for the current value of something.
 */
export interface ObjectBucket {
	readonly name: string;
	/** Stores the bytes under `key`, replacing what was there. */
	put(key: string, data: Uint8Array): Promise<void>;
	/** The bytes, or null when the key is absent. */
	get(key: string): Promise<Uint8Array | null>;
	delete(key: string): Promise<void>;
}

/** Opens the bucket, creating it when missing. */
export async function openObjectBucket(nc: NatsConnection, name: string): Promise<ObjectBucket> {
	const store = await new Objm(nc).create(name);
	return {
		name,
		async put(key, data) {
			await store.putBlob({ name: key }, data);
		},
		get: (key) => store.getBlob(key),
		async delete(key) {
			// absent already is the state the caller wanted
			if (await store.info(key)) await store.delete(key);
		},
	};
}
