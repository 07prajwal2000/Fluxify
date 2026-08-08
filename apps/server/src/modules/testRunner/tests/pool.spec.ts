import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool, headroomMb } from "../pool";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** plenty of memory, so the pool always picks `max` */
const roomy = () => 4096;

const ENV_KEYS = [
	"TEST_RUNNER_MAX_WORKERS",
	"TEST_RUNNER_MIN_WORKERS",
	"TEST_RUNNER_FREEMEM_THRESHOLD_MB",
] as const;

afterEach(() => {
	for (const key of ENV_KEYS) delete process.env[key];
});

/** a task that records how many were running at its busiest moment */
function tracker() {
	let active = 0;
	let peak = 0;
	return {
		get peak() {
			return peak;
		},
		task: async () => {
			active++;
			peak = Math.max(peak, active);
			await tick();
			active--;
		},
	};
}

describe("createPool", () => {
	it("never runs more than the limit at once", async () => {
		const pool = createPool({ max: 2, min: 2, freeMb: roomy });
		const seen = tracker();

		await Promise.all(Array.from({ length: 5 }, () => pool.run(seen.task)));

		// exactly 2: it caps at the limit and it actually uses every slot
		expect(seen.peak).toBe(2);
		expect(pool.active).toBe(0);
		expect(pool.queued).toBe(0);
	});

	it("queues the overflow instead of dropping it", async () => {
		const pool = createPool({ max: 1, min: 1, freeMb: roomy });
		let ran = 0;
		const runs = Array.from({ length: 4 }, () =>
			pool.run(async () => {
				await tick();
				ran++;
			}),
		);

		expect(pool.active).toBe(1);
		expect(pool.queued).toBe(3);

		await Promise.all(runs);
		expect(ran).toBe(4);
	});

	it("releases the slot of a task that throws", async () => {
		const pool = createPool({ max: 1, min: 1, freeMb: roomy });
		const order: string[] = [];

		const failing = pool.run(async () => {
			order.push("boom");
			throw new Error("boom");
		});
		const after = pool.run(async () => {
			order.push("after");
		});

		await expect(failing).rejects.toThrow("boom");
		await after;

		// the rejection must not eat the slot — the queue still drains
		expect(order).toEqual(["boom", "after"]);
		expect(pool.active).toBe(0);
	});

	it("resolves with the task's value", async () => {
		const pool = createPool({ max: 1, min: 1, freeMb: roomy });
		expect(await pool.run(async () => 42)).toBe(42);
	});

	it("backs off to the minimum when headroom drops mid-run", async () => {
		let free = 4096;
		const pool = createPool({
			max: 4,
			min: 1,
			thresholdMb: 512,
			freeMb: () => free,
		});
		const seen = tracker();

		// runs synchronously, so the queued tasks below are admitted under the
		// lowered limit — this is the re-read-on-release behaviour
		const first = pool.run(async () => {
			free = 100;
			await tick();
		});
		const rest = Array.from({ length: 4 }, () => pool.run(seen.task));

		await Promise.all([first, ...rest]);
		expect(seen.peak).toBe(1);
	});

	it("uses the maximum again once headroom recovers", async () => {
		let free = 100;
		const pool = createPool({
			max: 3,
			min: 1,
			thresholdMb: 512,
			freeMb: () => free,
		});
		expect(pool.limit).toBe(1);

		free = 4096;
		expect(pool.limit).toBe(3);
	});

	it("defaults to 4 / 2 / 512MB", () => {
		expect(createPool({ freeMb: roomy }).limit).toBe(4);
		expect(createPool({ freeMb: () => 511 }).limit).toBe(2);
		expect(createPool({ freeMb: () => 512 }).limit).toBe(4);
	});

	it("takes the limits from the environment", () => {
		process.env.TEST_RUNNER_MAX_WORKERS = "7";
		process.env.TEST_RUNNER_MIN_WORKERS = "3";
		process.env.TEST_RUNNER_FREEMEM_THRESHOLD_MB = "2048";

		expect(createPool({ freeMb: roomy }).limit).toBe(7);
		expect(createPool({ freeMb: () => 1024 }).limit).toBe(3);
	});

	it("ignores env values that are not positive integers", () => {
		process.env.TEST_RUNNER_MAX_WORKERS = "0";
		process.env.TEST_RUNNER_MIN_WORKERS = "lots";

		expect(createPool({ freeMb: roomy }).limit).toBe(4);
		expect(createPool({ freeMb: () => 0 }).limit).toBe(2);
	});

	it("never lets the minimum exceed the maximum", () => {
		// otherwise a misconfigured pair raises concurrency exactly when memory
		// is short
		expect(createPool({ max: 2, min: 8, freeMb: () => 0 }).limit).toBe(2);
	});
});

describe("headroomMb", () => {
	function cgroup(files: Record<string, string>) {
		const dir = mkdtempSync(join(tmpdir(), "fluxify-cgroup-"));
		for (const [name, body] of Object.entries(files)) {
			writeFileSync(join(dir, name), body);
		}
		return dir;
	}

	it("reports the cgroup's headroom, not the host's", () => {
		const dir = cgroup({
			// the shape docker writes for `-m 2g`, trailing newline included
			"memory.max": "2147483648\n",
			"memory.current": "1073741824\n",
		});
		expect(headroomMb(dir)).toBe(1024);
	});

	it("falls back to the host when the cgroup is uncapped", () => {
		const dir = cgroup({ "memory.max": "max\n", "memory.current": "1024\n" });
		// parsing "max" as a number would give NaN, which fails this assertion
		expect(headroomMb(dir)).toBeGreaterThan(0);
	});

	it("falls back to the host when there is no cgroupfs", () => {
		expect(headroomMb(join(tmpdir(), "fluxify-no-cgroup"))).toBeGreaterThan(0);
	});

	it("falls back when the cgroup files are only half there", () => {
		const dir = cgroup({ "memory.max": "2147483648\n" });
		expect(headroomMb(dir)).toBeGreaterThan(0);
	});
});
