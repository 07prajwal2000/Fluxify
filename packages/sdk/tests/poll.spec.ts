import { describe, expect, it } from "bun:test";
import { getEventListeners } from "node:events";
import { recordingLogger, runTrigger } from "../testing.js";
import { poll, sleep, trigger } from "../triggers.js";

const base = { label: "Poll", icon: "./poll.svg" };

/** resolves once `check` holds, or rejects after `timeout` ms */
async function until(check: () => void, timeout = 2000) {
	const end = Date.now() + timeout;
	for (;;) {
		try {
			return check();
		} catch (error) {
			if (Date.now() > end) throw error;
			await Bun.sleep(5);
		}
	}
}

describe("sleep", () => {
	it("resolves on abort, not only when the time is up, and removes its listener", async () => {
		const controller = new AbortController();
		const started = Date.now();
		const waiting = sleep(60_000, controller.signal);
		expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
		controller.abort();
		await waiting;
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
	});

	it("resolves at once on an already-aborted signal and adds no listener", async () => {
		const controller = new AbortController();
		controller.abort();
		await sleep(60_000, controller.signal);
		expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
	});

	it("leaves no listener after many waits", async () => {
		const controller = new AbortController();
		for (let i = 0; i < 20; i++) await sleep(0, controller.signal);
		expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
	});
});

describe("poll", () => {
	it("runs the first tick at once, waits `every` between ticks, and stops promptly mid-wait", async () => {
		let ticks = 0;
		const run = await runTrigger(
			trigger({
				...base,
				name: "acme/t/poll",
				async start(ctx) {
					return poll(ctx, {
						every: 60_000,
						tick: () => {
							ticks++;
						},
					});
				},
			}),
		);
		await until(() => expect(ticks).toBe(1));
		const stopped = Date.now();
		await run.stop();
		expect(Date.now() - stopped).toBeLessThan(2_000);
		expect(ticks).toBe(1);
	});

	it('runs the next tick at once when tick returns "again"', async () => {
		let ticks = 0;
		const started = Date.now();
		const run = await runTrigger(
			trigger({
				...base,
				name: "acme/t/again",
				async start(ctx) {
					return poll(ctx, {
						// long enough that waiting even once would miss the window below
						every: 60_000,
						tick: () => {
							ticks++;
							return ticks < 5 ? "again" : undefined;
						},
					});
				},
			}),
		);
		await until(() => expect(ticks).toBe(5));
		expect(Date.now() - started).toBeLessThan(2_000);
		await run.stop();
	});

	it("keeps going after a transient error, logging a warning", async () => {
		let calls = 0;
		const run = await runTrigger(
			trigger({
				...base,
				name: "acme/t/transient",
				async start(ctx) {
					return poll(ctx, {
						every: 0,
						tick: () => {
							calls++;
							if (calls === 1) throw new Error("connection reset");
						},
					});
				},
			}),
		);
		await until(() => expect(calls).toBeGreaterThan(2));
		expect(
			run.logs.some(
				(log) => log.level === "warn" && String(log.value).includes("connection reset"),
			),
		).toBe(true);
		expect(run.failure).toBeUndefined();
		await run.stop();
	});

	it('"fail" calls ctx.fail once, with the tick error, and ends the loop', async () => {
		let calls = 0;
		let errors = 0;
		const run = await runTrigger(
			trigger({
				...base,
				name: "acme/t/fatal",
				async start(ctx) {
					return poll(ctx, {
						every: 0,
						tick: () => {
							calls++;
							throw new Error("WRONGTYPE");
						},
						onError: () => {
							errors++;
							return "fail";
						},
					});
				},
			}),
		);
		expect((await run.failed()).message).toBe("WRONGTYPE");
		expect(errors).toBe(1);
		await Bun.sleep(20);
		expect(calls).toBe(1);
		await run.stop();
	});

	it("an onError that throws fails the trigger with what it threw", async () => {
		const run = await runTrigger(
			trigger({
				...base,
				name: "acme/t/throw",
				async start(ctx) {
					return poll(ctx, {
						every: 0,
						tick: () => {
							throw new Error("the tick failed");
						},
						onError: () => {
							throw new Error("this cannot be fixed");
						},
					});
				},
			}),
		);
		expect((await run.failed()).message).toBe("this cannot be fixed");
		await run.stop();
	});

	it("reports no error raised after stop", async () => {
		let reject!: (error: Error) => void;
		const running = new Promise<never>((_, r) => (reject = r));
		let errors = 0;
		const run = await runTrigger(
			trigger({
				...base,
				name: "acme/t/late",
				async start(ctx) {
					return poll(ctx, {
						every: 0,
						tick: () => running,
						onError: () => {
							errors++;
						},
					});
				},
			}),
		);
		const stop = run.stop();
		reject(new Error("raised while stopping"));
		await stop;
		expect(errors).toBe(0);
		expect(run.failure).toBeUndefined();
	});

	it("the stop function waits for the tick in progress", async () => {
		let finished = false;
		let release!: () => void;
		const running = new Promise<void>((resolve) => (release = resolve));
		const run = await runTrigger(
			trigger({
				...base,
				name: "acme/t/wait",
				async start(ctx) {
					return poll(ctx, {
						every: 0,
						tick: async () => {
							await running;
							finished = true;
						},
					});
				},
			}),
		);
		let stopped = false;
		const stop = run.stop().then(() => (stopped = true));
		await Bun.sleep(20);
		expect(stopped).toBe(false);
		expect(finished).toBe(false);
		release();
		await stop;
		expect(finished).toBe(true);
	});

	it("runs no tick once the signal aborted, and leaves no listener on it", async () => {
		const controller = new AbortController();
		const logger = recordingLogger();
		let ticks = 0;
		const stop = poll(
			{ signal: controller.signal, logger, fail: () => {} },
			{
				every: 0,
				tick: () => {
					ticks++;
				},
			},
		);
		await until(() => expect(ticks).toBeGreaterThan(2));
		controller.abort();
		await stop;
		expect(ticks).toBeGreaterThan(2);
		expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
		const after = ticks;
		await Bun.sleep(20);
		expect(ticks).toBe(after);
	});

	it("starts nothing when the signal was aborted before poll ran", async () => {
		const controller = new AbortController();
		controller.abort();
		let ticks = 0;
		const stop = poll(
			{ signal: controller.signal, logger: recordingLogger(), fail: () => {} },
			{
				every: 0,
				tick: () => {
					ticks++;
				},
			},
		);
		await stop();
		expect(ticks).toBe(0);
	});
});
