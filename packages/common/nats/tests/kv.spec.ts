import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as kvModule from "@nats-io/kv";
import type { KV, KvEntry } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core";
import { openKvBucket } from "../kv";

/** Lets the detached loops drain before assertions, like `queue.spec.ts`. */
const settled = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** A KV entry as the store hands it out. */
const entry = (key: string, revision: number, operation: "PUT" | "DEL" = "PUT"): KvEntry =>
	({ key, revision, operation, value: new TextEncoder().encode(JSON.stringify(key)) }) as KvEntry;

/** One watch iterator the test drives: push entries, end it, or fail it. */
function controllableIterator() {
	const queue: Array<{ entry?: KvEntry; done?: boolean; error?: unknown }> = [];
	let wake: (() => void) | null = null;
	const push = (item: (typeof queue)[number]) => {
		queue.push(item);
		wake?.();
	};
	const iterator = {
		[Symbol.asyncIterator]: () => ({
			next: async (): Promise<IteratorResult<KvEntry>> => {
				while (!queue.length) await new Promise<void>((r) => (wake = r));
				const item = queue.shift() as (typeof queue)[number];
				if (item.error) throw item.error;
				if (item.done) return { done: true, value: undefined as never };
				return { done: false, value: item.entry as KvEntry };
			},
			return: async () => ({ done: true, value: undefined as never }) as const,
		}),
		stop: async () => push({ done: true }),
	};
	return {
		iterator,
		send: (e: KvEntry) => push({ entry: e }),
		end: () => push({ done: true }),
		error: (err: unknown) => push({ error: err }),
	};
}

type Controller = ReturnType<typeof controllableIterator>;

/** A fake store: each `watch` call hands out a new controllable iterator. */
function fakeStore() {
	const watches: Controller[] = [];
	const data = new Map<string, KvEntry>();
	const state = { watchFailures: 0, watchCalls: 0 };
	const store = {
		watch: async () => {
			state.watchCalls++;
			if (state.watchFailures > 0) {
				state.watchFailures--;
				throw new Error("jetstream not ready");
			}
			const c = controllableIterator();
			watches.push(c);
			return c.iterator;
		},
		keys: async () => [...data.keys()],
		get: async (key: string) => data.get(key) ?? null,
	} as unknown as KV;
	return { store, watches, data, state };
}

/** A fake connection whose status stream the test drives. */
function fakeConnection() {
	let drain = false;
	const statusQueue = controllableStatus();
	const nc = {
		isClosed: () => false,
		isDraining: () => drain,
		status: () => statusQueue.iterable,
	} as unknown as NatsConnection;
	return { nc, reconnect: () => statusQueue.push("reconnect"), setDraining: (v: boolean) => (drain = v) };
}

function controllableStatus() {
	const queue: Array<{ type: string }> = [];
	let wake: (() => void) | null = null;
	return {
		push: (type: string) => {
			queue.push({ type });
			wake?.();
		},
		iterable: {
			[Symbol.asyncIterator]: () => ({
				next: async () => {
					while (!queue.length) await new Promise<void>((r) => (wake = r));
					return { done: false, value: queue.shift() };
				},
			}),
		},
	};
}

mock.module("@nats-io/kv", () => ({
	...kvModule,
	Kvm: class {
		create = async () => fake.store;
	},
}));

let fake: ReturnType<typeof fakeStore>;
let conn: ReturnType<typeof fakeConnection>;
let fatal: unknown[];
let changes: Array<[string, unknown]>;

beforeEach(() => {
	fake = fakeStore();
	conn = fakeConnection();
	fatal = [];
	changes = [];
});

const watchAt = (i: number) => fake.watches[i] as Controller;

async function watchOne(includeExisting = false) {
	const bucket = await openKvBucket(conn.nc, "test", {});
	const watcher = await bucket.watch("k", (key, value) => void changes.push([key, value]), {
		includeExisting,
		onFatal: (e) => fatal.push(e),
		rewatchBackoffMs: 5,
		rewatchDeadlineMs: 60,
	});
	await watcher.initialized;
	return watcher;
}

describe("kv watch ending", () => {
	it("calls onFatal when the watch ends without stop()", async () => {
		await watchOne();
		watchAt(0).end();
		await settled();
		expect(fatal).toEqual([undefined]);
	});

	it("does not call onFatal when stop() ended the watch", async () => {
		const watcher = await watchOne();
		await watcher.stop();
		await settled();
		expect(fatal).toHaveLength(0);
	});

	it("calls onFatal with the error when the watch throws", async () => {
		await watchOne();
		const err = new Error("connection lost");
		watchAt(0).error(err);
		await settled();
		expect(fatal).toHaveLength(1);
		expect(fatal[0]).toBe(err);
	});

	it("does not call onFatal when the connection is draining", async () => {
		await watchOne();
		conn.setDraining(true);
		watchAt(0).end();
		await settled();
		expect(fatal).toHaveLength(0);
	});
});

describe("kv watch across a reconnect", () => {
	it("re-opens the watch and replays the snapshot", async () => {
		fake.data.set("a", entry("a", 1));
		await watchOne(true);
		expect(changes).toEqual([["a", "a"]]);

		fake.data.set("a", entry("a", 3));
		fake.data.set("b", entry("b", 2));
		conn.reconnect();
		await settled();

		expect(fake.watches).toHaveLength(2);
		expect(fatal).toHaveLength(0);
		// "a" moved to revision 3 while away, "b" is new
		expect(changes.map(([k]) => k).sort()).toEqual(["a", "a", "b"]);
		// the new watch is the live one
		watchAt(1).send(entry("c", 4));
		await settled();
		expect(changes.at(-1)).toEqual(["c", "c"]);
	});

	it("does not re-deliver values it already applied", async () => {
		fake.data.set("a", entry("a", 1));
		await watchOne(true);
		conn.reconnect();
		await settled();
		expect(changes).toEqual([["a", "a"]]);
	});

	it("delivers a key deleted while disconnected as a delete", async () => {
		fake.data.set("a", entry("a", 1));
		fake.data.set("b", entry("b", 2));
		await watchOne(true);
		changes.length = 0;

		fake.data.delete("a");
		conn.reconnect();
		await settled();

		expect(changes).toEqual([["a", null]]);
	});

	it("applies a recreated bucket whose revisions restarted lower", async () => {
		fake.data.set("a", entry("a", 7));
		await watchOne(true);
		changes.length = 0;

		const reset = entry("a", 1);
		reset.created = new Date(Date.now() + 1000);
		fake.data.set("a", reset);
		conn.reconnect();
		await settled();

		expect(changes).toEqual([["a", "a"]]);
	});

	it("retries when the re-watch fails, then recovers without fatal", async () => {
		await watchOne();
		fake.state.watchFailures = 2;
		conn.reconnect();
		await settled(40);
		expect(fake.state.watchCalls).toBe(4);
		expect(fake.watches).toHaveLength(2);
		expect(fatal).toHaveLength(0);
	});

	it("calls onFatal when the re-watch keeps failing past the deadline", async () => {
		await watchOne();
		fake.state.watchFailures = 1000;
		conn.reconnect();
		await settled(150);
		expect(fatal).toHaveLength(1);
		expect((fatal[0] as Error).message).toBe("jetstream not ready");
	});

	it("does not re-watch after stop()", async () => {
		const watcher = await watchOne();
		await watcher.stop();
		conn.reconnect();
		await settled();
		expect(fake.state.watchCalls).toBe(1);
	});

	it("does not re-watch while the connection is draining", async () => {
		await watchOne();
		conn.setDraining(true);
		conn.reconnect();
		await settled();
		expect(fake.state.watchCalls).toBe(1);
	});

	it("does not call onFatal when the replaced iterator ends", async () => {
		await watchOne();
		conn.reconnect();
		await settled();
		watchAt(0).end();
		await settled();
		expect(fatal).toHaveLength(0);
	});
});
