import { beforeEach, describe, expect, it } from "bun:test";
import { orchestratorKeys } from "@fluxify/common/orchestrator";
import { createLease } from "../leader";

/**
 * The lease against a fake store that behaves the way NATS KV does: `create`
 * only writes an empty key, `update` only writes the revision it was given,
 * and a key can vanish under its holder when the TTL runs out. Those three
 * rules are the whole reason one leader stays one leader.
 */
function fakeStore() {
	const values = new Map<string, { value: unknown; revision: number }>();
	let revisions = 0;
	return {
		async create(key: string, value: unknown) {
			if (values.has(key)) return null;
			values.set(key, { value, revision: ++revisions });
			return revisions;
		},
		async update(key: string, value: unknown, revision: number) {
			const held = values.get(key);
			if (!held || held.revision !== revision) return null;
			values.set(key, { value, revision: ++revisions });
			return revisions;
		},
		async delete(key: string) {
			values.delete(key);
		},
		/** What the TTL does on its own once a holder stops renewing. */
		expire(key: string) {
			values.delete(key);
		},
	};
}

let store: ReturnType<typeof fakeStore>;
const key = orchestratorKeys.leader;

describe("the orchestrator lease", () => {
	beforeEach(() => {
		store = fakeStore();
	});

	it("lets one process reconcile and tells the other to stand by", async () => {
		const first = createLease(store, "a");
		const second = createLease(store, "b");
		expect(await first.tick()).toBe(true);
		expect(await second.tick()).toBe(false);
	});

	it("keeps the lease across passes instead of handing it round", async () => {
		const leader = createLease(store, "a");
		const standby = createLease(store, "b");
		await leader.tick();
		expect(await leader.tick()).toBe(true);
		expect(await standby.tick()).toBe(false);
		expect(await leader.tick()).toBe(true);
	});

	it("hands over when the leader's key expires, and the old leader cannot take it back", async () => {
		const leader = createLease(store, "a");
		const standby = createLease(store, "b");
		await leader.tick();

		// the leader died, or was paused long enough to look dead
		store.expire(key);
		expect(await standby.tick()).toBe(true);

		// its remembered revision is gone and the key is not empty any more. A
		// blind write here would mean two reconcilers creating the same
		// container twice and fighting over its labels.
		expect(await leader.tick()).toBe(false);
		expect(await standby.tick()).toBe(true);
	});

	it("releases on a clean shutdown, so the standby does not wait out the TTL", async () => {
		const leader = createLease(store, "a");
		const standby = createLease(store, "b");
		await leader.tick();
		await leader.release();
		expect(await standby.tick()).toBe(true);
	});

	it("stands by when the broker is unreachable, rather than acting without a lease", async () => {
		const lease = createLease(
			{
				...store,
				create: async () => {
					throw new Error("no connection");
				},
			},
			"a",
		);
		expect(await lease.tick()).toBe(false);
	});
});
