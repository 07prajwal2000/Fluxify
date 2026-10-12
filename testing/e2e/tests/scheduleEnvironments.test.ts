import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { type QueueConsumer, scheduleSubjects } from "@fluxify/common/nats";
import { natsConnection, natsName } from "@fluxify/server/src/db/nats";
import { type JobWorker, startJobWorker } from "@fluxify/server/src/modules/jobs/consumer";
import { runJob } from "@fluxify/server/src/modules/jobs/registry";
import { startFireConsumer } from "@fluxify/server/src/modules/schedules/fire";
import {
	removeScheduleEverywhere,
	syncSchedule,
} from "@fluxify/server/src/modules/schedules/reconciler";
import {
	SCHEDULES_STREAM,
	scheduleSubject,
} from "@fluxify/server/src/modules/schedules/subjects";
import { loadWorkflow } from "../src/graph";
import {
	SCHEDULE_TIMEOUT_MS,
	hitsOn,
	scheduleHarness,
	stopSchedules,
	waitForRuns,
} from "../src/schedule";
import { WORKFLOW_PROJECT_ID, publishWorkflow, resetSink } from "../src/workflow";

/**
 * A schedule fires where its workflow is live (#777), end to end on a graph.
 *
 * The production half of the harness runs a schedule fire through the real
 * broker into the real compiled graph. This adds the development half — a
 * development fire consumer and a development job worker — so the same graph
 * can be run by either environment and the sink says which one actually ran it.
 *
 * The decision under test is which environment's scheduler holds the schedule,
 * so every case publishes to both namespaces through `syncSchedule` and then
 * waits for the sink to prove a fire reached the worker that should have it.
 */
const collect = await loadWorkflow("collect");
const TRIGGER = "sched-env-dev";
const TRIGGER_PROD = "sched-env-prod";

let devFires: QueueConsumer | undefined;
let devJobs: JobWorker | undefined;

beforeAll(async () => {
	// production: the fire consumer, the compiled runtime, the job worker, the sink
	await scheduleHarness();
	devFires = await startFireConsumer({
		projectId: WORKFLOW_PROJECT_ID,
		env: "development",
		maxDeliver: 3,
		retryDelayMs: 250,
	});
	devJobs = await startJobWorker({
		projectId: WORKFLOW_PROJECT_ID,
		mode: "workflow",
		env: "development",
		handle: (job) => runJob(job),
		concurrency: 3,
		ackWaitMs: 5_000,
		maxDeliver: 3,
		retryDelayMs: 250,
	});
}, 180_000);

afterAll(async () => {
	for (const id of [TRIGGER, TRIGGER_PROD])
		await removeScheduleEverywhere(WORKFLOW_PROJECT_ID, id).catch(() => {});
	await devFires?.stop().catch(() => {});
	await devJobs?.stop().catch(() => {});
	await stopSchedules();
});

beforeEach(resetSink);

const trigger = (id: string) => ({
	id,
	projectId: WORKFLOW_PROJECT_ID,
	workflowId: collect.name,
	schedule: "@every 1s",
	timezone: "UTC",
});

/** Whether a trigger's schedule is on the broker in `env`'s own stream. */
async function scheduledIn(env: "production" | "development", triggerId: string) {
	const subject = natsName(scheduleSubject(WORKFLOW_PROJECT_ID, triggerId), env);
	const live = await scheduleSubjects(
		natsConnection(),
		natsName(SCHEDULES_STREAM, env),
		subject,
	);
	return live.includes(subject);
}

describe("a schedule trigger and its workflow's switches", () => {
	it(
		"fires on the development worker while devActive is on, and stops when it is off",
		async () => {
			await publishWorkflow(collect);
			await syncSchedule(
				trigger(TRIGGER),
				{ active: false, devActive: true, prodVersionId: null },
				true,
			);
			expect(await scheduledIn("development", TRIGGER)).toBe(true);
			expect(await scheduledIn("production", TRIGGER)).toBe(false);

			// a fire reached the development worker and ran the graph
			await waitForRuns("/collected", 1);

			// flip development off: the schedule goes away and no more runs land
			await syncSchedule(
				trigger(TRIGGER),
				{ active: false, devActive: false, prodVersionId: null },
				true,
			);
			expect(await scheduledIn("development", TRIGGER)).toBe(false);

			const settled = hitsOn("/collected").length;
			await Bun.sleep(1_500);
			await Bun.sleep(2_500);
			expect(hitsOn("/collected").length).toBe(settled);
		},
		SCHEDULE_TIMEOUT_MS,
	);

	it(
		"fires on production only once the workflow is active and promoted",
		async () => {
			await publishWorkflow(collect);

			// active but never promoted, development off: nothing fires anywhere
			await syncSchedule(
				trigger(TRIGGER_PROD),
				{ active: true, devActive: false, prodVersionId: null },
				true,
			);
			expect(await scheduledIn("production", TRIGGER_PROD)).toBe(false);
			expect(await scheduledIn("development", TRIGGER_PROD)).toBe(false);
			await Bun.sleep(2_500);
			expect(hitsOn("/collected").length).toBe(0);

			// promoted: production's schedule appears and the graph runs there
			await syncSchedule(
				trigger(TRIGGER_PROD),
				{ active: true, devActive: false, prodVersionId: "v1" },
				true,
			);
			expect(await scheduledIn("production", TRIGGER_PROD)).toBe(true);
			await waitForRuns("/collected", 1);
		},
		SCHEDULE_TIMEOUT_MS,
	);
});
