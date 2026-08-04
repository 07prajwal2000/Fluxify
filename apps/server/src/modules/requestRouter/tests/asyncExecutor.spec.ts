import { describe, expect, it } from "bun:test";
import {
	AsyncExecutor,
	asyncExecutorLimitsFromEnv,
} from "../asyncExecutor";

describe("AsyncExecutor", () => {
	it("keeps active and queued work within its configured bounds", async () => {
		const started: number[] = [];
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		const executor = new AsyncExecutor(
			{ maxInFlight: 1, maxQueueDepth: 1, drainTimeoutMs: 1_000 },
			() => {},
		);

		expect(executor.submit(async () => { started.push(1); await blocked; })).toBe(true);
		expect(executor.submit(async () => { started.push(2); })).toBe(true);
		expect(executor.submit(async () => { started.push(3); })).toBe(false);
		await Promise.resolve();
		expect(executor.snapshot()).toEqual({ inFlight: 1, queued: 1, accepting: true });

		release();
		expect(await executor.drain()).toBe(true);
		expect(started).toEqual([1, 2]);
		expect(executor.snapshot()).toEqual({ inFlight: 0, queued: 0, accepting: false });
	});

	it("contains background failures and continues with queued work", async () => {
		const errors: unknown[] = [];
		const completed: number[] = [];
		const executor = new AsyncExecutor(
			{ maxInFlight: 1, maxQueueDepth: 1, drainTimeoutMs: 1_000 },
			(error) => errors.push(error),
		);

		executor.submit(async () => { throw new Error("expected"); });
		executor.submit(async () => { completed.push(1); });

		expect(await executor.drain()).toBe(true);
		expect(errors).toHaveLength(1);
		expect(completed).toEqual([1]);
	});

	it("allows active work with a zero-depth queue but rejects a second task", async () => {
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		const executor = new AsyncExecutor(
			{ maxInFlight: 1, maxQueueDepth: 0, drainTimeoutMs: 1_000 },
			() => {},
		);

		expect(executor.submit(async () => { await blocked; })).toBe(true);
		expect(executor.submit(async () => {})).toBe(false);
		release();
		expect(await executor.drain()).toBe(true);
	});
});

describe("asyncExecutorLimitsFromEnv", () => {
	it("uses bounded defaults and rejects invalid environment values", () => {
		expect(asyncExecutorLimitsFromEnv({
			ASYNC_EXECUTOR_MAX_IN_FLIGHT: "0",
			ASYNC_EXECUTOR_MAX_QUEUE_DEPTH: "-1",
			ASYNC_EXECUTOR_DRAIN_TIMEOUT_MS: "invalid",
		})).toEqual({ maxInFlight: 1, maxQueueDepth: 100, drainTimeoutMs: 30_000 });
	});
});
