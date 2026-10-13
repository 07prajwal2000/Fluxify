import { type KV, type KvEntry, KvWatchInclude } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core";
import { logger } from "../logging";
import { onReconnect } from "./reconnect";

export interface KvWatchOptions {
	/**
	 * Replay the current value of every matching key before streaming updates.
	 * Default true — a watcher that only sees future writes starts out blind to
	 * everything already stored. Also decides whether a reconnect replays: a
	 * watcher that never asked for existing values is only re-opened.
	 */
	includeExisting?: boolean;
	/**
	 * Called when the watch can no longer be kept alive: the iterator ended or
	 * threw without `stop()`, or it could not be re-opened after a reconnect
	 * within `rewatchDeadlineMs`. The default logs loudly and exits the process:
	 * NATS KV is a hard dependency, so carrying on with stale state is the worse
	 * failure. Override only to inject the handler in tests.
	 */
	onFatal?: (error: unknown) => void;
	/** How long to keep retrying a re-watch after a reconnect. Default 60s. */
	rewatchDeadlineMs?: number;
	/** First retry delay, doubling up to 5s. Default 1s. */
	rewatchBackoffMs?: number;
}

export interface KvWatcher {
	/**
	 * Resolves once every pre-existing value has been handed to `onChange`, so a
	 * caller can await a complete picture before serving traffic.
	 */
	initialized: Promise<void>;
	stop(): Promise<void>;
}

/**
 * Default response to a dead watch: NATS KV is a hard dependency, so log the
 * death loudly and exit. The supervisor, a compose restart policy or Helm then
 * restarts the process and `startWatch` opens a fresh watch, which replays
 * everything.
 */
function defaultOnFatal(bucket: string, filter: string | string[]): (error: unknown) => void {
	return (error: unknown) => {
		logger.error(
			`[nats] kv watch ${bucket}/${filter} ended unexpectedly${error ? `: ${String(error)}` : ""}, exiting process`,
			"NATS",
		);
		process.exit(1);
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
 *
 * After a reconnect the watch is closed and opened again the same way (see
 * `reconnect.ts` for why). The snapshot re-applies idempotently through the
 * revisions map, and any key we had seen live that the snapshot no longer lists
 * was deleted (or purged) while we were away: that is delivered as a null. A
 * delete can therefore reach `onChange` twice (replay, then the buffered DEL
 * entry); a null is idempotent for every consumer.
 */
export async function startWatch<T>(
	nc: NatsConnection,
	store: KV,
	bucket: string,
	filter: string | string[],
	onChange: (key: string, value: T | null) => void | Promise<void>,
	decode: (entry: KvEntry | null) => T | null,
	{
		includeExisting = true,
		onFatal,
		rewatchDeadlineMs = 60_000,
		rewatchBackoffMs = 1_000,
	}: KvWatchOptions,
): Promise<KvWatcher> {
	const revisions = new Map<string, number>();
	const created = new Map<string, number | undefined>();
	const live = new Set<string>();
	let buffer: KvEntry[] | null = null;
	let stopped = false;
	let generation = 0;
	let current: { stop(): Promise<void> | void } | null = null;

	const defaultFatal = onFatal ?? defaultOnFatal(bucket, filter);
	// closeNats() drains the connection, which ends every watch not stopped first:
	// that is a graceful shutdown, not a broker drop.
	const closing = () => stopped || nc.isClosed() || nc.isDraining();
	const fatal = (error: unknown) => {
		if (!closing()) defaultFatal(error);
	};

	// A snapshot read is the truth, so it only skips an identical entry (same
	// revision and creation time): a recreated bucket restarts its revisions at 1,
	// which must not read as "older" than what we saw before. A buffered update
	// is skipped when not newer than what we hold.
	async function apply(entry: KvEntry, snapshot = false) {
		const seen = revisions.get(entry.key);
		const stamp = entry.created?.getTime();
		if (seen !== undefined) {
			if (
				snapshot
					? seen === entry.revision && created.get(entry.key) === stamp
					: seen >= entry.revision
			)
				return;
		}
		revisions.set(entry.key, entry.revision);
		created.set(entry.key, stamp);
		if (entry.operation === "PUT") live.add(entry.key);
		else live.delete(entry.key);
		await onChange(entry.key, decode(entry));
	}

	async function pump(iterator: AsyncIterable<KvEntry>, gen: number) {
		try {
			for await (const entry of iterator) {
				if (gen !== generation) return;
				if (buffer) buffer.push(entry);
				else await apply(entry);
			}
			// Ended on its own rather than from stop() or a re-watch: the broker
			// dropped us. Exit and let the supervisor restart us with a fresh watch
			// instead of serving stale state.
			if (gen === generation) fatal(undefined);
		} catch (error) {
			if (gen === generation) fatal(error);
		}
	}

	async function replay() {
		const present = new Set<string>();
		for await (const key of await store.keys(filter)) {
			present.add(key);
			const entry = await store.get(key);
			if (entry) await apply(entry, true);
		}
		for (const key of [...revisions.keys()]) {
			if (present.has(key)) continue;
			revisions.delete(key);
			created.delete(key);
			if (live.delete(key)) await onChange(key, null);
		}
		const pending = buffer ?? [];
		buffer = null;
		for (const entry of pending) await apply(entry);
	}

	/** Closes the current watch (if any) and opens a new one, buffering if replaying. */
	async function begin() {
		const old = current;
		const gen = ++generation;
		await Promise.resolve(old?.stop()).catch(() => {});
		const iterator = await store.watch({ key: filter, include: KvWatchInclude.UpdatesOnly });
		current = iterator;
		buffer = includeExisting ? [] : null;
		void pump(iterator, gen);
	}

	let rewatching = false;
	async function rewatch() {
		if (closing() || rewatching) return;
		rewatching = true;
		const deadline = Date.now() + rewatchDeadlineMs;
		let delay = rewatchBackoffMs;
		try {
			for (;;) {
				try {
					await begin();
					if (includeExisting) await replay();
					return;
				} catch (error) {
					if (closing()) return;
					if (Date.now() + delay > deadline) return fatal(error);
					await new Promise((resolve) => setTimeout(resolve, delay));
					delay = Math.min(delay * 2, 5_000);
				}
			}
		} finally {
			rewatching = false;
		}
	}

	await begin();
	const unsubscribe = onReconnect(nc, () => void rewatch());

	return {
		initialized: includeExisting ? replay() : Promise.resolve(),
		stop: async () => {
			stopped = true;
			unsubscribe();
			await current?.stop();
		},
	};
}
