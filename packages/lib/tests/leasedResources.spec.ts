import { describe, expect, it } from "bun:test";
import { LeasedResources, type ResourceTimer } from "../leasedResources";

class FakeTimers implements ResourceTimer {
	private now = 0;
	private nextId = 1;
	private readonly tasks = new Map<number, { at: number; handler: () => void }>();

	setTimeout(handler: () => void, timeoutMs: number) {
		const id = this.nextId++;
		this.tasks.set(id, { at: this.now + timeoutMs, handler });
		return id;
	}

	clearTimeout(handle: unknown) {
		this.tasks.delete(handle as number);
	}

	advanceBy(timeoutMs: number) {
		this.now += timeoutMs;
		for (const [id, task] of [...this.tasks]) {
			if (task.at > this.now) continue;
			this.tasks.delete(id);
			task.handler();
		}
	}
}

const tick = async () => {
	for (let i = 0; i < 4; i++) await Promise.resolve();
};

function setup(idleTimeoutMs = 1000) {
	const timers = new FakeTimers();
	const pool = new LeasedResources<string>({ idleTimeoutMs, timer: timers });
	const log: string[] = [];
	let made = 0;
	const spec = (name: string, extra: { idleMs?: number; destroy?: () => unknown } = {}) => ({
		create: () => `${name}#${++made}`,
		destroy: (value: string) => {
			log.push(`close ${value}`);
			return extra.destroy?.();
		},
		idleMs: extra.idleMs,
	});
	return { timers, pool, log, spec, made: () => made };
}

const throws = (message: string) => () => {
	throw new Error(message);
};

describe("LeasedResources", () => {
	it("creates lazily, once per slot", () => {
		const { pool, spec, made } = setup();
		expect(made()).toBe(0);
		const a = pool.acquire("s", "f", spec("a"));
		const b = pool.acquire("s", "f", spec("a"));
		expect(made()).toBe(1);
		expect(a.value).toBe(b.value);
		expect(pool.getStats()).toEqual({ active: 1, retiring: 0, leases: 2 });
	});

	it("does not close while leased, closes after the idle time once released", async () => {
		const { pool, timers, log, spec } = setup(1000);
		const lease = pool.acquire("s", "f", spec("a"));
		timers.advanceBy(5000);
		await tick();
		expect(log).toEqual([]);

		lease.release();
		timers.advanceBy(999);
		await tick();
		expect(log).toEqual([]);
		timers.advanceBy(1);
		await tick();
		expect(log).toEqual(["close a#1"]);
		expect(pool.getStats()).toEqual({ active: 0, retiring: 0, leases: 0 });
	});

	it("an acquire resets the idle timer", async () => {
		const { pool, timers, log, spec } = setup(1000);
		pool.acquire("s", "f", spec("a")).release();
		timers.advanceBy(999);
		pool.acquire("s", "f", spec("a")).release();
		timers.advanceBy(999);
		await tick();
		expect(log).toEqual([]);
	});

	it("idleMs on the spec overrides the default; 0 never idle-closes", async () => {
		const { pool, timers, log, spec } = setup(1000);
		pool.acquire("short", "f", spec("s", { idleMs: 100 })).release();
		pool.acquire("never", "f", spec("n", { idleMs: 0 })).release();
		timers.advanceBy(100_000);
		await tick();
		expect(log).toEqual(["close s#1"]);
		await pool.close();
		expect(log).toEqual(["close s#1", "close n#2"]);
	});

	it("a changed fingerprint swaps the resource and closes the old one when its leases drain", async () => {
		const { pool, log, spec } = setup();
		const old = pool.acquire("s", "f1", spec("a"));
		const next = pool.acquire("s", "f2", spec("a"));
		expect(next.value).toBe("a#2");
		await tick();
		expect(log).toEqual([]);
		expect(pool.getStats().retiring).toBe(1);

		old.release();
		await tick();
		expect(log).toEqual(["close a#1"]);
		expect(pool.getStats()).toEqual({ active: 1, retiring: 0, leases: 1 });
	});

	it("discard drops the resource, so the next acquire builds a fresh one", async () => {
		const { pool, log, spec, made } = setup();
		pool.acquire("s", "f", spec("a")).discard();
		await tick();
		expect(log).toEqual(["close a#1"]);
		pool.acquire("s", "f", spec("a"));
		expect(made()).toBe(2);
	});

	it("a create that throws caches nothing and the next acquire retries", () => {
		const pool = new LeasedResources<string>();
		let attempts = 0;
		const spec = {
			create: () => {
				if (++attempts === 1) throw new Error("down");
				return "ok";
			},
			destroy: () => {},
		};
		expect(() => pool.acquire("s", "f", spec)).toThrow("down");
		expect(pool.getStats().active).toBe(0);
		expect(pool.acquire("s", "f", spec).value).toBe("ok");
	});

	it("a failing replacement keeps the known-good resource serving", () => {
		const { pool, spec } = setup();
		pool.acquire("s", "f1", spec("a"));
		const broken = { create: throws("nope"), destroy: () => {} };
		expect(() => pool.acquire("s", "f2", broken)).toThrow("nope");
		expect(pool.acquire("s", "f1", spec("a")).value).toBe("a#1");
	});

	it("a destroy that throws or rejects is logged, never thrown", async () => {
		const { pool, spec, log } = setup();
		pool.acquire("a", "f", spec("a", { destroy: throws("sync") }));
		pool.acquire("b", "f", spec("b", { destroy: () => Promise.reject(new Error("async")) }));
		await pool.close();
		expect(log).toEqual(["close a#1", "close b#2"]);
		expect(pool.getStats().retiring).toBe(0);
	});

	it("closes a retiring resource after the drain timeout even if a lease is held", async () => {
		const timers = new FakeTimers();
		const pool = new LeasedResources<string>({ drainTimeoutMs: 500, timer: timers });
		const log: string[] = [];
		const spec = (v: string) => ({ create: () => v, destroy: () => void log.push(v) });
		pool.acquire("s", "f1", spec("old"));
		pool.acquire("s", "f2", spec("new"));
		timers.advanceBy(500);
		await tick();
		expect(log).toEqual(["old"]);
	});

	it("shutdown closes every resource, held or not, once", async () => {
		const { pool, log, spec } = setup();
		pool.acquire("a", "f", spec("a"));
		pool.acquire("b", "f", spec("b")).release();
		await Promise.all([pool.close(), pool.close()]);
		expect(log.sort()).toEqual(["close a#1", "close b#2"]);
		expect(pool.getStats()).toEqual({ active: 0, retiring: 0, leases: 0 });
	});

	it("remove takes a slot out of service and closes it when drained", async () => {
		const { pool, log, spec } = setup();
		const lease = pool.acquire("s", "f", spec("a"));
		pool.remove("s");
		expect(pool.fingerprints()).toEqual([]);
		lease.release();
		await tick();
		expect(log).toEqual(["close a#1"]);
	});
});
