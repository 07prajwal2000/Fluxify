import { compileGraph } from "@fluxify/blocks";
import { deleteArtifact, putArtifact } from "@fluxify/server/src/db/natsKv";
import { hydrateAppConfig } from "@fluxify/server/src/loaders/appconfigLoader";
import type { WorkflowArtifact } from "@fluxify/server/src/modules/compiler/artifacts";
import { workflowKey } from "@fluxify/server/src/modules/compiler/subjects";
import { startJobWorker } from "@fluxify/server/src/modules/jobs/consumer";
import { enqueueJob } from "@fluxify/server/src/modules/jobs/publisher";
import { runJob } from "@fluxify/server/src/modules/jobs/registry";
import {
	WORKFLOW_JOB,
	artifactKindsForMode,
} from "@fluxify/server/src/modules/jobs/subjects";
import type { JobEnvelope } from "@fluxify/server/src/modules/jobs/types";
import { registerWorkflowJobHandler } from "@fluxify/server/src/modules/jobs/workflowJob";
import { watchProjectArtifacts } from "@fluxify/server/src/modules/requestRouter/artifactHost";
import {
	applyArtifactUpdate,
	compiledWorkflow,
	initCompiledRuntime,
} from "@fluxify/server/src/modules/requestRouter/compiledRuntime";
import type { WorkflowFixture } from "./graph";
import { nats, stopNats } from "./nats";

/**
 * Runs a workflow fixture the way a deployed worker does, over a real broker.
 *
 * This is the seam `src/runner.ts` deliberately skips. A route is called; a
 * workflow is *queued*, and everything interesting about it lives in the
 * transport: the artifact reaches the worker as a KV watch update, the run
 * reaches it as a JetStream message, and the only thing deciding whether the
 * work is retried or forgotten is whether the handler threw. None of that can
 * be tested with an in-process call, so nothing here is stubbed:
 *
 *   putArtifact -> KV watch -> compiled runtime
 *   enqueueJob  -> JetStream work queue -> job worker -> workflow handler
 *
 * The one thing that is not real is where the work runs. A deployment puts the
 * graph in a child process and the broker in the supervisor; here they share
 * one, which is what lets a test observe the run at all.
 *
 * Deep imports into apps/server on purpose, the same as `runner.ts`: these are
 * the modules a worker deployment wires together, and the package barrel would
 * drag in Postgres.
 */

export const WORKFLOW_PROJECT_ID = "e2e-workflows";
/** The ceiling every workflow test runs under — pass it as the test timeout. */
export const WORKFLOW_TIMEOUT_MS = 10_000;

/**
 * Deliveries before the broker gives up on a failing job, and the wait between
 * them. The production defaults are 5 attempts 10s apart, which no test can sit
 * through; what is under test is the retry itself, not its pacing.
 */
const MAX_DELIVER = 3;
const RETRY_DELAY_MS = 250;
/** Long enough for three deliveries, short enough to beat the test timeout. */
const SETTLE_TIMEOUT_MS = 8_000;
/** How long a KV write may take to reach the worker's compiled runtime. */
const ARTIFACT_TIMEOUT_MS = 3_000;

/** One request a workflow's HTTP block made, as the receiver saw it. */
export type SinkHit = { path: string; body: any };

export type WorkflowRun = {
	/** True when the job was acked — a failed graph is retried, then dropped. */
	ok: boolean;
	/** Deliveries it took to settle. More than one means the queue retried. */
	attempts: number;
	error?: string;
	/**
	 * What the workflow actually did, in order. A background run answers nobody,
	 * so this is the only evidence a test has about which blocks ran.
	 */
	hits: SinkHit[];
};

let sink: ReturnType<typeof Bun.serve> | undefined;
let watcher: Awaited<ReturnType<typeof watchProjectArtifacts>> | undefined;
let hits: SinkHit[] = [];
/** path -> how many more requests to answer with a 500 */
const failures = new Map<string, number>();
const published = new Set<string>();
let harness: Promise<void> | undefined;

/**
 * Starts the broker, the worker and the sink. Call from `beforeAll` — the
 * container start is what makes the first workflow test slow, and it has no
 * business inside a 10s budget.
 */
export function workflowHarness(): Promise<void> {
	return (harness ??= start());
}

/** Drops the recorded requests and any injected failures. Call in `beforeEach`. */
export function resetSink() {
	hits = [];
	failures.clear();
}

/** Makes the sink refuse the next `times` requests to `path` with a 500. */
export function failNext(path: string, times: number) {
	failures.set(path, times);
}

/** Compiles, publishes and queues a fixture, then waits for the job to settle. */
export async function runWorkflow(
	fixture: WorkflowFixture,
	payload?: unknown,
): Promise<WorkflowRun> {
	await workflowHarness();
	await publishWorkflow(fixture);
	return queueJob(fixture.name, payload);
}

/** Queues a job by target id, for a target no artifact was published for. */
export async function runTarget(
	target: string,
	payload?: unknown,
): Promise<WorkflowRun> {
	await workflowHarness();
	return queueJob(target, payload);
}

/** Removes a workflow's artifact, the way deactivating or deleting one does. */
export async function unpublishWorkflow(fixture: WorkflowFixture) {
	await workflowHarness();
	published.delete(fixture.name);
	await deleteArtifact(workflowKey(WORKFLOW_PROJECT_ID, fixture.name));
	await waitFor(
		() => compiledWorkflow(fixture.name) === undefined,
		`workflow ${fixture.name} was still loaded after its artifact was deleted`,
	);
}

/* ------------------------------------------------------------------ start */

async function start() {
	await nats();
	sink = startSink();
	// the fixtures reach the sink through `getConfig`, the same seam a real
	// workflow reads a base URL from — the port is only known at runtime
	hydrateAppConfig(WORKFLOW_PROJECT_ID, {
		E2E_SINK_URL: `http://127.0.0.1:${sink.port}`,
	});

	// the execution side of a worker, started with nothing loaded; every
	// artifact below arrives the way a deployed one does, over the KV watch
	initCompiledRuntime([]);
	watcher = await watchProjectArtifacts(
		WORKFLOW_PROJECT_ID,
		(entry) => applyArtifactUpdate(entry.key, entry.value),
		artifactKindsForMode("workflow"),
	);
	await watcher.initialized;

	registerWorkflowJobHandler();
	await startJobWorker({
		projectId: WORKFLOW_PROJECT_ID,
		mode: "workflow",
		handle: settleJob,
		concurrency: 5,
		ackWaitMs: 5_000,
		maxDeliver: MAX_DELIVER,
		retryDelayMs: RETRY_DELAY_MS,
	});
}

/** Stops the sink and the broker. Called once, from the suite teardown. */
export async function stopWorkflows() {
	await watcher?.stop().catch(() => {});
	sink?.stop(true);
	watcher = undefined;
	sink = undefined;
	harness = undefined;
	published.clear();
	await stopNats();
}

/* ------------------------------------------------------------------- sink */

/**
 * Stands in for whatever a workflow actually talks to, and can be told to fail
 * so a graph has a realistic reason to be retried.
 */
function startSink() {
	return Bun.serve({
		port: 0,
		async fetch(request) {
			const { pathname } = new URL(request.url);
			hits.push({
				path: pathname,
				body: await request.json().catch(() => null),
			});
			const remaining = failures.get(pathname) ?? 0;
			if (remaining > 0) {
				failures.set(pathname, remaining - 1);
				return new Response("sink refused", { status: 500 });
			}
			return Response.json({ ok: true });
		},
	});
}

/* ------------------------------------------------------------------- jobs */

type Settlement = {
	attempts: number;
	ok: boolean;
	error?: string;
	settled: Promise<void>;
	finish: () => void;
};

const settlements = new Map<string, Settlement>();

/**
 * The worker's `handle`, wrapped so a test can wait for an outcome.
 *
 * It still throws on failure, because that throw *is* the retry mechanism —
 * swallowing it here would ack every broken workflow and quietly delete the
 * behaviour these tests exist to check.
 */
async function settleJob(job: JobEnvelope) {
	const settlement = settlements.get(job.id);
	const attempt = job.attempt ?? 1;
	if (settlement) settlement.attempts = attempt;
	try {
		await runJob(job);
		if (settlement) {
			settlement.ok = true;
			settlement.finish();
		}
	} catch (error) {
		if (settlement) {
			settlement.error = String(error);
			// the broker gives up on this delivery too, so nothing else is coming
			if (attempt >= MAX_DELIVER) settlement.finish();
		}
		throw error;
	}
}

async function queueJob(target: string, payload: unknown): Promise<WorkflowRun> {
	const id = crypto.randomUUID();
	let finish!: () => void;
	const settled = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const settlement: Settlement = { attempts: 0, ok: false, settled, finish };
	settlements.set(id, settlement);

	await enqueueJob({
		id,
		kind: WORKFLOW_JOB,
		projectId: WORKFLOW_PROJECT_ID,
		target,
		payload,
	});
	try {
		await withTimeout(
			settled,
			SETTLE_TIMEOUT_MS,
			`workflow job ${target} never settled`,
		);
	} finally {
		settlements.delete(id);
	}

	return {
		ok: settlement.ok,
		attempts: settlement.attempts,
		error: settlement.error,
		hits: [...hits],
	};
}

/* -------------------------------------------------------------- artifacts */

async function publishWorkflow(fixture: WorkflowFixture) {
	if (published.has(fixture.name)) return;
	const compiledAt = new Date().toISOString();
	// `asWorkflow` is the only thing the compiler is told: a response block has
	// nothing to respond to here, so it compiles to a plain terminal
	const { source } = compileGraph(fixture.blocks, fixture.edges, {
		asWorkflow: true,
	});
	const artifact: WorkflowArtifact = {
		workflowId: fixture.name,
		projectId: WORKFLOW_PROJECT_ID,
		projectName: "E2E",
		name: fixture.name,
		timeoutSeconds: fixture.timeoutSeconds ?? 30,
		tracingEnabled: false,
		recordExecution: false,
		workflowVersion: compiledAt,
		source,
		compiledAt,
	};
	await putArtifact(workflowKey(WORKFLOW_PROJECT_ID, fixture.name), artifact);
	// the KV write is itself the fan-out; the worker learns of it a moment later
	await waitFor(
		() => compiledWorkflow(fixture.name) !== undefined,
		`workflow ${fixture.name} never reached the worker`,
	);
	published.add(fixture.name);
}

/* ------------------------------------------------------------------ waits */

async function waitFor(
	condition: () => boolean,
	message: string,
	timeoutMs = ARTIFACT_TIMEOUT_MS,
) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) return;
		await Bun.sleep(25);
	}
	throw new Error(message);
}

/** Fails naming what was being waited on, rather than as a bare test timeout. */
async function withTimeout(work: Promise<void>, ms: number, message: string) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${message} (${ms}ms)`)), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
