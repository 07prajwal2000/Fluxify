import { describe, expect, it } from "bun:test";
import { createSemaphore } from "../concurrency";

describe("createSemaphore", () => {
	it("never exceeds the limit", async () => {
		const slots = createSemaphore(2);
		await slots.acquire();
		await slots.acquire();
		expect(slots.active).toBe(2);

		let third = false;
		const pending = slots.acquire().then(() => {
			third = true;
		});
		await Promise.resolve();
		expect(third).toBe(false);

		slots.release();
		await pending;
		expect(third).toBe(true);
		// the released slot was handed to the waiter, not given back to the pool
		expect(slots.active).toBe(2);
	});

	it("returns the slot when nobody is waiting", async () => {
		const slots = createSemaphore(1);
		await slots.acquire();
		slots.release();
		expect(slots.active).toBe(0);
	});
});

describe("createSemaphore.resize", () => {
	it("starts waiting work at once when the limit goes up", async () => {
		const slots = createSemaphore(1);
		await slots.acquire();
		let started = 0;
		const waiting = [slots.acquire(), slots.acquire()].map((p) => p.then(() => started++));

		slots.resize(3);
		await Promise.all(waiting);
		expect(started).toBe(2);
		expect(slots.active).toBe(3);
	});

	it("leaves holders alone when the limit goes down, and holds new work back until they drain", async () => {
		const slots = createSemaphore(3);
		await Promise.all([slots.acquire(), slots.acquire(), slots.acquire()]);
		let fourth = false;
		const pending = slots.acquire().then(() => {
			fourth = true;
		});

		slots.resize(1);
		expect(slots.active).toBe(3);

		slots.release(); // 2 held, still over the limit of 1
		slots.release(); // 1 held, at the limit: the waiter must still wait
		await Promise.resolve();
		expect(fourth).toBe(false);
		expect(slots.active).toBe(1);

		slots.release(); // under the limit now
		await pending;
		expect(fourth).toBe(true);
		expect(slots.active).toBe(1);
	});
});
