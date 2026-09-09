import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { loadWorkflow } from "../src/graph";
import { resetSink } from "../src/workflow";
import {
	SCHEDULE_TIMEOUT_MS,
	hitsOn,
	schedule,
	scheduleCount,
	scheduleHarness,
	startFires,
	stopFires,
	unschedule,
	waitForRuns,
} from "../src/schedule";

/**
 * Schedules over a real broker, on a real clock.
 *
 * Every wait here is a wait for the server to fire something. That is slow by
 * construction — the shortest schedule is one second — and it is the only way
 * to find out whether the headers we send actually mean what we think.
 */
const collect = await loadWorkflow("collect");

beforeAll(scheduleHarness, 180_000);
beforeEach(resetSink);

describe("a recurring schedule", () => {
	it(
		"runs the workflow, and stops when the schedule is removed",
		async () => {
			await schedule("sched-every", collect, "@every 1s", {
				payload: { id: "tick" },
			});

			const runs = await waitForRuns("/collected", 2);
			expect(runs[0]!.body).toMatchObject({ size: 1, source: "schedule" });
			// The trigger's payload is what a scheduled run receives — a fire
			// carries no data of its own.
			expect(runs[0]!.body.input).toEqual({ id: "tick" });

			await unschedule("sched-every");
			// One fire may already be in flight; nothing may arrive after that.
			await Bun.sleep(1_500);
			const settled = hitsOn("/collected").length;
			await Bun.sleep(2_500);
			expect(hitsOn("/collected").length).toBe(settled);
		},
		SCHEDULE_TIMEOUT_MS,
	);

	it(
		"replaces itself on republish rather than stacking",
		async () => {
			// One subject holds one schedule. If a republish added a second, every
			// edit would leave another copy firing forever.
			await schedule("sched-replace", collect, "@every 5s");
			await schedule("sched-replace", collect, "@every 6s");
			await schedule("sched-replace", collect, "@every 7s");

			expect(await scheduleCount("sched-replace")).toBe(1);

			await unschedule("sched-replace");
			expect(await scheduleCount("sched-replace")).toBe(0);
		},
		SCHEDULE_TIMEOUT_MS,
	);
});

describe("after downtime", () => {
	it(
		"does not deliver the whole backlog at once",
		async () => {
			// The catch-up storm, in miniature: a schedule firing every second
			// while nothing is reading. Without a TTL on the generated fires, the
			// seconds spent down would each be waiting when the consumer returns.
			await schedule("sched-backlog", collect, "@every 1s");
			await waitForRuns("/collected", 1);

			await stopFires();
			const before = hitsOn("/collected").length;
			await Bun.sleep(6_000);
			await startFires();
			await Bun.sleep(2_000);

			const missed = hitsOn("/collected").length - before;
			// Six seconds down is six fires generated. A TTL of half the interval
			// leaves at most the one or two still inside their lifetime.
			expect(missed).toBeLessThan(4);

			await unschedule("sched-backlog");
		},
		30_000,
	);
});
