import { openKvBucket, type KvBucket } from "@fluxify/common/nats";
import { initializeNats } from "./nats";

/**
 * Compiled artifacts live in a NATS KV bucket rather than the database, so a
 * request worker never needs a Postgres connection to serve traffic. The bucket
 * mechanics are in `@fluxify/common/nats`; this file owns the bucket's name and
 * the process-wide handle.
 */
export const ARTIFACT_BUCKET = "fluxify_artifacts";

let bucket: Promise<KvBucket<unknown>> | null = null;

export function artifactStore(): Promise<KvBucket<unknown>> {
	// history 1 — only the current artifact matters
	bucket ??= initializeNats().then((nc) =>
		openKvBucket<unknown>(nc, ARTIFACT_BUCKET, { history: 1 }),
	);
	return bucket;
}

export async function putArtifact(key: string, value: unknown) {
	await (await artifactStore()).put(key, value);
}

export async function getArtifact<T>(key: string): Promise<T | null> {
	return (await artifactStore()).get(key) as Promise<T | null>;
}

export async function deleteArtifact(key: string) {
	await (await artifactStore()).delete(key);
}

/**
 * Push updates for a key filter. `initialized` resolves once every existing
 * value has been delivered, so a worker can await a complete picture before
 * serving traffic.
 */
export async function watchArtifacts<T>(
	filter: string | string[],
	onChange: (key: string, value: T | null) => void | Promise<void>,
	options: { includeExisting?: boolean } = {},
) {
	const store = await artifactStore();
	// The bucket is JSON, so a decoded value is `unknown` and the caller names
	// the shape it expects. The cast belongs on the value, not the callback.
	return store.watch(filter, (key, value) => onChange(key, value as T | null), {
		includeExisting: options.includeExisting === true,
	});
}
