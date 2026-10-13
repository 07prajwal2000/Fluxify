import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as kvModule from "@nats-io/kv";
import type { KV, KvWatchEntry } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core";
import { openKvBucket } from "../kv";

const nc = {} as NatsConnection;

/** Resolve once the watch has been ended, errored, or stopped. */
function deferred() {
	let resolve!: (value: void) => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** Lets the detached watch loop drain before assertions, like `queue.spec.ts`. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 5));

/**
 * A watch iterator whose completion the test drives. Until `end`, `error` or
 * `stop` resolves it, `next` blocks — so the watch loop is still live when the
 * test picks its fate, and `stopped` (set by `stop`) is observed before the loop
 * wakes up.
 */
function controllableWatch() {
	const { promise, resolve } = deferred();
	let fail: unknown = null;
	const iterator = {
		[Symbol.asyncIterator]: () => ({
			next: async () => {
				await promise;
				if (fail) throw fail;
				return { done: true, value: undefined as unknown as KvWatchEntry } as const;
			},
			return: async () => ({ done: true, value: undefined as unknown as KvWatchEntry }) as const,
		}),
		stop: async () => resolve(),
	};
	const store = { watch: async () => iterator } as unknown as KV;
	return {
		store,
		end: () => resolve(),
		error: (err: unknown) => {
			fail = err;
			resolve();
		},
	};
}

mock.module("@nats-io/kv", () => ({
	...kvModule,
	Kvm: class {
		create = async () => store;
	},
}));

let store: KV;
let watch: ReturnType<typeof controllableWatch>;
let fatal: unknown[];

beforeEach(() => {
	watch = controllableWatch();
	store = watch.store;
	fatal = [];
});

describe("kv watch", () => {
	function watchOne() {
		return openKvBucket(nc, "test", {}).then((b) =>
			b.watch("k", () => {}, { includeExisting: false, onFatal: (e) => fatal.push(e) }),
		);
	}

	it("calls onFatal when the watch ends without stop()", async () => {
		const watcher = await watchOne();
		await watcher.initialized;
		watch.end();
		await settled();
		expect(fatal).toEqual([undefined]);
	});

	it("does not call onFatal when stop() ended the watch", async () => {
		const watcher = await watchOne();
		await watcher.initialized;
		await watcher.stop();
		await settled();
		expect(fatal).toHaveLength(0);
	});

	it("calls onFatal with the error when the watch throws", async () => {
		const watcher = await watchOne();
		await watcher.initialized;
		const err = new Error("connection lost");
		watch.error(err);
		await settled();
		expect(fatal).toHaveLength(1);
		expect(fatal[0]).toBe(err);
	});
});
