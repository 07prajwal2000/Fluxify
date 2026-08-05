import { logger } from "@fluxify/common";
import {
	KvWatchInclude,
	StringCodec,
	type KV,
	type KvEntry,
} from "nats";
import { natsConnection } from "./nats";

/**
 * Compiled artifacts live in a NATS KV bucket rather than the database, so a
 * request worker never needs a Postgres connection to serve traffic. KV is a
 * JetStream stream underneath, which is what makes `watch` possible: workers
 * subscribe to their project's key prefix and get every update pushed to them.
 */
export const ARTIFACT_BUCKET = "fluxify_artifacts";

const sc = StringCodec();
let bucket: KV | null = null;

export async function artifactStore(): Promise<KV> {
	if (bucket) return bucket;
	const js = natsConnection().jetstream();
	// creates the bucket when missing; history 1 — only the current artifact matters
	bucket = await js.views.kv(ARTIFACT_BUCKET, { history: 1 });
	return bucket;
}

export async function putArtifact(key: string, value: unknown) {
	const store = await artifactStore();
	await store.put(key, sc.encode(JSON.stringify(value)));
}

export async function getArtifact<T>(key: string): Promise<T | null> {
	const store = await artifactStore();
	const entry = await store.get(key);
	if (!entry || entry.operation !== "PUT") return null;
	return decode<T>(entry);
}

export async function deleteArtifact(key: string) {
	const store = await artifactStore();
	await store.delete(key);
}

/** every artifact whose key matches the filter, e.g. `route.<projectId>.*` */
export async function listArtifacts<T>(
	filter: string | string[],
): Promise<{ key: string; value: T }[]> {
	const store = await artifactStore();
	const found: { key: string; value: T }[] = [];
	const keys = await store.keys(filter);
	for await (const key of keys) {
		const value = await getArtifact<T>(key);
		if (value) found.push({ key, value });
	}
	return found;
}

/**
 * Push updates for a key filter. Callers can request the initial replay and
 * await `initialized` before treating the watched state as complete.
 */
export async function watchArtifacts<T>(
	filter: string | string[],
	onChange: (key: string, value: T | null) => void | Promise<void>,
	options: { includeExisting?: boolean } = {},
) {
	const store = await artifactStore();
	const includeExisting = options.includeExisting === true;
	let resolveInitialized: (() => void) | undefined;
	let rejectInitialized: ((error: Error) => void) | undefined;
	let initialized = !includeExisting;
	const initialization = new Promise<void>((resolve, reject) => {
		resolveInitialized = resolve;
		rejectInitialized = reject;
	});
	const iterator = await store.watch({
		key: filter,
		// `initializedFn` signals replay completion; it does not disable replay.
		include: includeExisting
			? KvWatchInclude.LastValue
			: KvWatchInclude.UpdatesOnly,
		initializedFn: includeExisting
			? () => {
				initialized = true;
				resolveInitialized?.();
			}
			: undefined,
	});

	void (async () => {
		try {
			for await (const entry of iterator) {
				try {
					await onChange(
						entry.key,
						entry.operation === "PUT" ? decode<T>(entry) : null,
					);
				} catch (error) {
					logger.error(
						`[KV] failed handling ${entry.key}: ${String(error)}`,
						"KV.watch",
					);
				}
			}
		} catch (error) {
			if (!initialized) {
				rejectInitialized?.(
					error instanceof Error ? error : new Error(String(error)),
				);
			}
			logger.error(`[KV] artifact watch stopped: ${String(error)}`, "KV.watch");
		} finally {
			if (!initialized) {
				rejectInitialized?.(
					new Error("artifact watch stopped before initial replay completed"),
				);
			}
		}
	})();

	return {
		initialized: includeExisting ? initialization : Promise.resolve(),
		stop: () => {
			iterator.stop();
		},
	};
}

function decode<T>(entry: KvEntry): T {
	return JSON.parse(sc.decode(entry.value)) as T;
}
