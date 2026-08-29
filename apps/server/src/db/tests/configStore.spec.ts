import { beforeEach, describe, expect, it, mock } from "bun:test";
import z from "zod";

/**
 * In-memory stand-in for a NATS KV bucket — enough of it to exercise replay,
 * push, and the boot rebuild without a broker.
 */
type Watcher = (key: string, value: unknown) => void | Promise<void>;
const kv = new Map<string, unknown>();
const watchers: Array<{ prefix: string; fn: Watcher }> = [];

const matches = (filter: string, key: string) =>
	filter.endsWith(">") ? key.startsWith(filter.slice(0, -1)) : key === filter;

mock.module("../nats", () => ({ initializeNats: async () => ({}) }));
mock.module("@fluxify/common/nats", () => ({
	openKvBucket: async () => ({
		get: async (key: string) => kv.get(key) ?? null,
		put: async (key: string, value: unknown) => {
			kv.set(key, value);
			for (const w of watchers) if (matches(w.prefix, key)) await w.fn(key, value);
			return 1;
		},
		delete: async (key: string) => {
			kv.delete(key);
			for (const w of watchers) if (matches(w.prefix, key)) await w.fn(key, null);
		},
		keys: async (filter: string) =>
			[...kv.keys()].filter((k) => matches(filter, k)),
		watch: async (filter: string, fn: Watcher) => {
			watchers.push({ prefix: filter, fn });
			for (const [k, v] of kv) if (matches(filter, k)) await fn(k, v);
			return { initialized: Promise.resolve(), stop: async () => {} };
		},
	}),
}));

const { createConfigStore } = await import("../configStore");

const registry = {
	flags: {
		schema: z.object({ beta: z.boolean(), token: z.string().optional() }),
		publicSchema: z.object({ beta: z.boolean() }),
	},
};

const newStore = () => createConfigStore({ prefix: "cfg", registry });

beforeEach(() => {
	kv.clear();
	watchers.length = 0;
});

describe("config store", () => {
	it("reconciles the authoritative rows into KV on boot", async () => {
		const store = newStore();
		await store.start({
			reconcile: async () => [
				{ key: "flags", value: { beta: true }, isPublic: true },
			],
		});
		expect(store.get("flags")).toEqual({ beta: true });
		expect(kv.get("cfg.flags")).toEqual({ value: { beta: true }, isPublic: true });
	});

	it("prunes keys the authoritative store no longer has", async () => {
		kv.set("cfg.flags", { value: { beta: true }, isPublic: true });
		const store = newStore();
		await store.start({ reconcile: async () => [] });
		expect(kv.has("cfg.flags")).toBe(false);
		expect(store.get("flags")).toBeNull();
	});

	it("replays existing values to a watcher that owns no database", async () => {
		kv.set("cfg.flags", { value: { beta: true }, isPublic: false });
		const worker = newStore();
		await worker.start({}); // no reconcile — the worker never reads Postgres
		expect(worker.get("flags")).toEqual({ beta: true });
	});

	it("pushes a write to every watcher, without firing onChange on replay", async () => {
		const changes: string[] = [];
		const worker = newStore();
		await worker.start({ onChange: (key) => void changes.push(key) });
		expect(changes).toEqual([]); // replay is not a change

		const writer = newStore();
		await writer.start({});
		await writer.put("flags", { beta: true }, false);

		expect(worker.get("flags")).toEqual({ beta: true });
		expect(changes).toEqual(["flags"]);
	});

	it("drops a value that fails its schema rather than caching it", async () => {
		const store = newStore();
		await store.start({
			reconcile: async () => [
				{ key: "flags", value: { beta: "yes" }, isPublic: true },
				{ key: "unknown_key", value: {}, isPublic: true },
			],
		});
		expect(store.get("flags")).toBeNull();
		expect(kv.has("cfg.unknown_key")).toBe(false); // never written
	});

	it("projects only public keys through publicSchema", async () => {
		const store = newStore();
		await store.start({});
		await store.put("flags", { beta: true, token: "secret" }, true);
		expect(store.getPublic()).toEqual({ flags: { beta: true } }); // token stripped

		await store.put("flags", { beta: true }, false);
		expect(store.getPublic()).toEqual({});
	});
});
