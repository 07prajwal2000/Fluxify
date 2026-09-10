import { natsConnection } from "@fluxify/server/src/db/nats";
import { scheduleSubjects } from "@fluxify/common/nats";
import { startFireConsumer } from "@fluxify/server/src/modules/schedules/fire";
import {
	removeSchedule,
	upsertSchedule,
} from "@fluxify/server/src/modules/schedules/reconciler";
import {
	SCHEDULES_STREAM,
	scheduleSubject,
} from "@fluxify/server/src/modules/schedules/subjects";
import type { WorkflowFixture } from "./graph";
import {
	WORKFLOW_PROJECT_ID,
	publishWorkflow,
	sinkHits,
	workflowHarness,
} from "./workflow";

/**
 * Scheduled triggers, end to end over a real broker.
 *
 * Nothing here fakes the clock. A test that wants a schedule to fire waits for
 * the broker to fire it, because "does the server actually generate a message
 * on time, and does anything notice" is the entire question — a harness that
 * synthesised the fire would pass whether or not a single header was right.
 *
 * That is also why these tests run in seconds rather than minutes: `@every 1s`
 * is a real schedule, so the shortest honest test is a few seconds long.
 */

/** The ceiling every schedule test runs under — pass it as the test timeout. */
export const SCHEDULE_TIMEOUT_MS = 20_000;

let fires: { stop(): Promise<void> } | undefined;
let started: Promise<void> | undefined;
const scheduled = new Set<string>();

export function scheduleHarness(): Promise<void> {
	return (started ??= start());
}

async function start() {
	await workflowHarness();
	await startFires();
}

/**
 * Starts the half that turns a fire into a job. Separate from the harness so a
 * test can stop it and watch what the broker does with fires nobody is reading.
 */
export async function startFires() {
	await workflowHarness();
	fires ??= await startFireConsumer({
		projectId: WORKFLOW_PROJECT_ID,
		maxDeliver: 3,
		retryDelayMs: 250,
	});
}

/** Stops consuming fires. They keep being generated — and keep expiring. */
export async function stopFires() {
	await fires?.stop().catch(() => {});
	fires = undefined;
}

/** Schedules a workflow, exactly as saving a scheduled trigger does. */
export async function schedule(
	triggerId: string,
	workflow: WorkflowFixture,
	spec: string,
	options: { timezone?: string; payload?: unknown } = {},
) {
	await scheduleHarness();
	await publishWorkflow(workflow);
	await upsertSchedule({
		id: triggerId,
		projectId: WORKFLOW_PROJECT_ID,
		workflowId: workflow.name,
		schedule: spec,
		timezone: options.timezone ?? "UTC",
		payload: options.payload,
	});
	scheduled.add(triggerId);
}

/** Stops a schedule, the way pausing or deleting a trigger does. */
export async function unschedule(triggerId: string) {
	await removeSchedule(WORKFLOW_PROJECT_ID, triggerId);
	scheduled.delete(triggerId);
}

/**
 * How many schedules sit on a trigger's subject. One subject holds one
 * schedule, so anything but 0 or 1 means a republish stacked instead of
 * replacing — and every extra copy is a duplicate run, forever.
 */
export async function scheduleCount(triggerId: string) {
	const subject = scheduleSubject(WORKFLOW_PROJECT_ID, triggerId);
	const live = await scheduleSubjects(natsConnection(), SCHEDULES_STREAM, subject);
	return live.length;
}

/** Requests the sink has answered on a path so far. */
export function hitsOn(path: string) {
	return sinkHits().filter((hit) => hit.path === path);
}

/** Waits until the sink has answered `count` requests on a path. */
export async function waitForRuns(path: string, count: number, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (hitsOn(path).length >= count) return hitsOn(path);
		await Bun.sleep(50);
	}
	throw new Error(
		`expected ${count} run(s) on ${path}, saw ${hitsOn(path).length}`,
	);
}

export async function stopSchedules() {
	for (const triggerId of scheduled) {
		await removeSchedule(WORKFLOW_PROJECT_ID, triggerId).catch(() => {});
	}
	scheduled.clear();
	await stopFires();
	started = undefined;
}
