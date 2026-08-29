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
