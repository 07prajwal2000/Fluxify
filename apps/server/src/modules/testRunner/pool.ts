import { readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

/** an env override is only usable as a limit if it is a positive integer */
function positiveInt(value: string | undefined, fallback: number) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Memory headroom in MB — the container's cgroup cap when there is one, the host
 * otherwise.
 *
 * `os.freemem()` on its own is useless here: it reads the HOST, not the cgroup.
 * Measured in `docker run --rm -m 2g oven/bun:1` — cap 2048 MB, `os.freemem()`
 * 10049 MB of 11804 MB "total". A 512 MB threshold against that never trips, so
 * the back-off tier would be dead code in the one place it matters. Suite
 * children are children of the admin process, so they count against the same
 * cgroup: this is the number that decides whether the container gets OOM-killed.
 *
 * cgroup v1 (`memory.limit_in_bytes`) is not read. v2 has been the Docker
 * default since 20.10, and v1 lands on the same host fallback as a Windows dev
 * box. `root` is a parameter only so the parsing can be tested off Linux.
 */
export function headroomMb(root = "/sys/fs/cgroup") {
	try {
		const max = readFileSync(join(root, "memory.max"), "utf8").trim();
		// "max" means uncapped — the host figure is the honest one then
		if (max !== "max") {
			const used = readFileSync(join(root, "memory.current"), "utf8");
			return (Number(max) - Number(used)) / 1048576;
		}
	} catch {
		// no cgroupfs: not Linux, cgroup v1, or running outside a container
	}
	return os.freemem() / 1048576;
}

export type PoolOptions = {
	max?: number;
	min?: number;
	thresholdMb?: number;
	/** injectable for tests; production reads the cgroup */
	freeMb?: () => number;
};

export type Pool = {
	/** runs `task` once a slot is free and always gives the slot back */
	run<T>(task: () => Promise<T>): Promise<T>;
	/** tasks running right now */
	readonly active: number;
	/** tasks waiting for a slot */
	readonly queued: number;
	/** the ceiling as of this moment — it moves with available memory */
	readonly limit: number;
};

/**
 * A counting semaphore. It takes an async task and resolves with its result; it
 * knows nothing about test suites, child processes or the database, which is
 * what keeps it testable without any of them.
 */
export function createPool(overrides: PoolOptions = {}): Pool {
	const max =
		overrides.max ?? positiveInt(process.env.TEST_RUNNER_MAX_WORKERS, 4);
	const configuredMin =
		overrides.min ?? positiveInt(process.env.TEST_RUNNER_MIN_WORKERS, 2);
	// a min above max would raise concurrency exactly when memory is short
	const min = Math.min(configuredMin, max);
	const thresholdMb =
		overrides.thresholdMb ??
		positiveInt(process.env.TEST_RUNNER_FREEMEM_THRESHOLD_MB, 512);
	const freeMb = overrides.freeMb ?? headroomMb;

	let active = 0;
	const waiting: Array<() => void> = [];
	const limit = () => (freeMb() < thresholdMb ? min : max);

	function release() {
		active--;
		// re-read the limit on every release rather than once at startup: the
		// point of the tier is to back off while the box is already under load
		while (active < limit() && waiting.length > 0) {
			active++;
			waiting.shift()?.();
		}
	}

	return {
		get active() {
			return active;
		},
		get queued() {
			return waiting.length;
		},
		get limit() {
			return limit();
		},
		async run<T>(task: () => Promise<T>): Promise<T> {
			if (active < limit()) {
				active++;
			} else {
				const { promise, resolve } = Promise.withResolvers<void>();
				waiting.push(resolve);
				// release() takes the slot on our behalf before waking us, so the
				// count cannot be raced by another caller in between
				await promise;
			}
			try {
				return await task();
			} finally {
				// every exit path, or a leaked slot shrinks the pool permanently
				release();
			}
		},
	};
}

/**
 * One pool for the whole admin process, deliberately not one per run: two people
 * each launching a fleet have to share the slots, or the cap is not a cap.
 */
export const testWorkerPool = createPool();
