import { deleteArtifact, putArtifact } from "@fluxify/server/src/db/natsKv";
import type { TriggerArtifact } from "@fluxify/server/src/modules/compiler/artifacts";
import {
	artifactId,
	triggerKey,
} from "@fluxify/server/src/modules/compiler/subjects";
import { runJob } from "@fluxify/server/src/modules/jobs/registry";
import type { JobEnvelope } from "@fluxify/server/src/modules/jobs/types";
import { TriggerWorker } from "@fluxify/server/src/modules/triggers/consumers";
import {
	fireInternalTrigger,
	publishTriggerEvent,
} from "@fluxify/server/src/modules/triggers/publisher";
import type { TriggerBatch } from "@fluxify/server/src/modules/triggers/types";
import type { WorkflowFixture } from "./graph";
import {
	WORKFLOW_PROJECT_ID,
	publishWorkflow,
	setTriggerArtifactHandler,
	sinkHits,
	workflowHarness,
} from "./workflow";

/**
 * Triggers, end to end over a real broker.
 *
 * The workflow harness already owns the broker, the sink and the compiled
 * runtime, so this adds only the half that is actually under test: a
 * `TriggerWorker` pulling batches off the triggers stream and handing them to
 * the same workflow handler a deployment uses.
 *
 * Nothing here fakes the batching. A test that wants five events in one run
 * publishes five messages and waits for the fetch to coalesce them, because
 * "did `fetch` actually return them together" is the entire question.
 */

/** The ceiling every trigger test runs under — pass it as the test timeout. */
export const TRIGGER_TIMEOUT_MS = 15_000;

/** Deliveries before the broker gives up, and the wait between them. */
const MAX_DELIVER = 3;
const RETRY_DELAY_MS = 250;
const CONSUMER_TIMEOUT_MS = 5_000;

/** One batch as the worker handed it over. */
export type ObservedBatch = {
	triggerId: string;
	workflowId: string;
	source: string;
	events: unknown[];
	ok: boolean;
	error?: string;
};

let worker: TriggerWorker | undefined;
let observed: ObservedBatch[] = [];
let started: Promise<void> | undefined;
const publishedTriggers = new Set<string>();

export function triggerHarness(): Promise<void> {
	return (started ??= start());
}

async function start() {
	await workflowHarness();
	worker = new TriggerWorker({
		projectId: WORKFLOW_PROJECT_ID,
		run: observe,
		maxDeliver: MAX_DELIVER,
		retryDelayMs: RETRY_DELAY_MS,
		defaultAckWaitMs: 5_000,
	});
	// The supervisor's other half: trigger artifacts arriving over the KV watch
	// start and stop consumers. Without this the artifact is written and nothing
	// ever reads it, which is precisely the "no restart needed" claim under test.
	setTriggerArtifactHandler((key, value) => {
		void worker
			?.apply(artifactId(key), value as TriggerArtifact | null)
			.catch((error) => console.error(`applying trigger ${key}:`, error));
	});
	await worker.start();
}

/**
 * Stands in for the supervisor's hop to the execution process: it runs the job,
 * then records what happened. The throw is preserved — that throw is what naks
 * the batch, and swallowing it would delete the retry behaviour under test.
 *
 * Recording happens in `finally`, after `ok`/`error` are already settled — never
 * before the run. Pushing an unsettled record let `waitForBatches` hand a test
 * a batch whose `ok` was still `false` because `runJob` just hadn't finished
 * yet, not because anything failed.
 */
async function observe(job: JobEnvelope) {
	const batch = job.payload as TriggerBatch;
	const record: ObservedBatch = {
		triggerId: batch.triggerId,
		workflowId: job.target,
		source: batch.source,
		events: batch.events.map((event) => event.data),
		ok: false,
	};
	try {
		await runJob(job);
		record.ok = true;
	} catch (error) {
		record.error = String(error);
		throw error;
	} finally {
		observed.push(record);
	}
}

/** Drops recorded batches. Call in `beforeEach`, alongside `resetSink`. */
export function resetTriggers() {
	observed = [];
}

export function observedBatches() {
	return [...observed];
}

/**
 * Publishes a trigger and waits for its consumer to exist.
 *
 * The wait is the point: creating a trigger must start consuming without a
 * restart, so a test that fired events before the consumer existed would be
 * testing the stream's retention instead.
 */
export async function publishTrigger(trigger: {
	triggerId: string;
	workflow: WorkflowFixture;
	batchSize?: number;
	maxWaitMs?: number;
	maxBytes?: number;
	concurrency?: number;
}) {
	await triggerHarness();
	await publishWorkflow(trigger.workflow);

	const artifact: TriggerArtifact = {
		triggerId: trigger.triggerId,
		projectId: WORKFLOW_PROJECT_ID,
		workflowId: trigger.workflow.name,
		groupId: "default",
		type: "internal",
		integrationId: null,
		batchSize: trigger.batchSize ?? 1,
		maxWaitMs: trigger.maxWaitMs ?? 500,
		maxBytes: trigger.maxBytes ?? 1024 * 1024,
		concurrency: trigger.concurrency ?? 1,
		publishedAt: new Date().toISOString(),
	};
	await putArtifact(triggerKey(WORKFLOW_PROJECT_ID, trigger.triggerId), artifact);
	publishedTriggers.add(trigger.triggerId);
	await waitFor(
		() => worker?.has(trigger.triggerId) === true,
		`trigger ${trigger.triggerId} never started a consumer`,
	);
}

/** Withdraws a trigger, the way deactivating or deleting one does. */
export async function unpublishTrigger(triggerId: string) {
	await triggerHarness();
	await deleteArtifact(triggerKey(WORKFLOW_PROJECT_ID, triggerId));
	publishedTriggers.delete(triggerId);
	await waitFor(
		() => worker?.has(triggerId) === false,
		`trigger ${triggerId} still had a consumer after its artifact was deleted`,
	);
}

/** Publishes events onto a trigger's own subject, as a connector would. */
export async function emit(triggerId: string, events: unknown[]) {
	await triggerHarness();
	for (const event of events) {
		await publishTriggerEvent(WORKFLOW_PROJECT_ID, triggerId, event);
	}
}

/** Fires a workflow the way the Trigger Workflow block and Run button do. */
export async function fireInternal(workflow: WorkflowFixture, data: unknown) {
	await triggerHarness();
	await publishWorkflow(workflow);
	return fireInternalTrigger({
		projectId: WORKFLOW_PROJECT_ID,
		workflowId: workflow.name,
		data,
	});
}

/** Waits until `count` batches have been handed over, then returns them. */
export async function waitForBatches(count: number, timeoutMs = 8_000) {
	await waitFor(
		() => observed.length >= count,
		`expected ${count} batch(es), saw ${observed.length}`,
		timeoutMs,
	);
	return observedBatches();
}

/** Waits until the sink has answered `count` requests on a path. */
export async function waitForHits(path: string, count: number, timeoutMs = 8_000) {
	await waitFor(
		() => sinkHits().filter((hit) => hit.path === path).length >= count,
		`expected ${count} request(s) to ${path}`,
		timeoutMs,
	);
	return sinkHits().filter((hit) => hit.path === path);
}

export async function stopTriggers() {
	for (const triggerId of publishedTriggers) {
		await deleteArtifact(triggerKey(WORKFLOW_PROJECT_ID, triggerId)).catch(() => {});
	}
	publishedTriggers.clear();
	setTriggerArtifactHandler(undefined);
	await worker?.stop().catch(() => {});
	worker = undefined;
	started = undefined;
}

async function waitFor(
	condition: () => boolean,
	message: string,
	timeoutMs = CONSUMER_TIMEOUT_MS,
) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) return;
		await Bun.sleep(25);
	}
	throw new Error(message);
}
