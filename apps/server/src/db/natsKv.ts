import { type KvBucket, openKvBucket } from "@fluxify/common/nats";
import { FLUXIFY_ENV, type FluxifyEnv } from "../lib/env";
import { initializeNats, natsName } from "./nats";

/**
 * Compiled artifacts live in a NATS KV bucket rather than the database, so a
 * request worker never needs a Postgres connection to serve traffic. The bucket
 * mechanics are in `@fluxify/common/nats`; this file owns the bucket's name and
 * the process-wide handle.
 *
 * One bucket per environment (#732): a worker watches its own, so a dev worker
 * never sees production's artifacts. Admin writes production only, for now.
 */
export const ARTIFACT_BUCKET = "fluxify_artifacts";

const buckets = new Map<FluxifyEnv, Promise<KvBucket<unknown>>>();

export function artifactStore(env: FluxifyEnv = FLUXIFY_ENV): Promise<KvBucket<unknown>> {
	let bucket = buckets.get(env);
	if (!bucket) {
		// history 1 — only the current artifact matters
		bucket = initializeNats().then((nc) =>
			openKvBucket<unknown>(nc, natsName(ARTIFACT_BUCKET, env), { history: 1 }),
		);
		buckets.set(env, bucket);
	}
	return bucket;
}

export async function putArtifact(key: string, value: unknown, env?: FluxifyEnv) {
	await (await artifactStore(env)).put(key, value);
}

export async function getArtifact<T>(key: string, env?: FluxifyEnv): Promise<T | null> {
	return (await artifactStore(env)).get(key) as Promise<T | null>;
}

export async function deleteArtifact(key: string, env?: FluxifyEnv) {
	await (await artifactStore(env)).delete(key);
}

/**
 * Push updates for a key filter. `initialized` resolves once every existing
 * value has been delivered, so a worker can await a complete picture before
 * serving traffic.
 */
export async function watchArtifacts<T>(
	filter: string | string[],
	onChange: (key: string, value: T | null) => void | Promise<void>,
	options: { includeExisting?: boolean; env?: FluxifyEnv } = {},
) {
	const store = await artifactStore(options.env);
	// The bucket is JSON, so a decoded value is `unknown` and the caller names
	// the shape it expects. The cast belongs on the value, not the callback.
	return store.watch(filter, (key, value) => onChange(key, value as T | null), {
		includeExisting: options.includeExisting === true,
	});
}
