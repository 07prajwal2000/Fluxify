import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeLogger, logger } from "@fluxify/common";
import {
	healthResponse,
	markDraining,
	markNotReady,
	markReady,
} from "../src/modules/requestRouter/health";
import {
	watchProjectArtifacts,
} from "../src/modules/requestRouter/artifactHost";
import type {
	TriggerArtifact,
	UnsealedProjectConfig,
	WorkflowArtifact,
} from "../src/modules/compiler/artifacts";
import { artifactId, artifactKind } from "../src/modules/compiler/subjects";
import { TriggerWorker } from "../src/modules/triggers/consumers";
import { consumedInExecution, runsHere } from "../src/modules/triggers/types";
import { startFireConsumer } from "../src/modules/schedules/fire";
import { fireInternalTrigger } from "../src/modules/triggers/publisher";
import { TRIGGER_WORKFLOW_JOB } from "@fluxify/blocks";
import type {
	ExecutionBootstrap,
	ExecutionEvent,
	ExecutionMessage,
} from "../src/modules/requestRouter/threadTypes";
import { ExecutionWatchdog } from "../src/modules/requestRouter/executionWatchdog";
import { workerTimeoutsEnabled } from "../src/modules/requestRouter/workerTimeouts";
import { asyncExecutorLimitsFromEnv, drainChild } from "../src/modules/requestRouter/asyncExecutor";
import { executionRuntimeEnvironment } from "../src/modules/requestRouter/executionEnvironment";
import type { ArtifactEntry } from "../src/modules/requestRouter/compiledRuntime";
import { closeNats } from "../src/db/nats";
import { RPC_SUBJECTS, rpcRequest } from "../src/db/natsRpc";
import { watchInstanceSettings } from "../src/loaders/instanceSettingsLoader";
import { canRunConnectors, nodeEntitlement, watchLicense } from "../src/lib/edition";
import { attachNode } from "../src/modules/orchestrator/node";
import type { NodeType } from "@fluxify/common/orchestrator";
import { startJobWorker } from "../src/modules/jobs/consumer";
import { enqueueJob } from "../src/modules/jobs/publisher";
import type { JobEnvelope } from "../src/modules/jobs/types";
import { publishTraceRun } from "../src/modules/telemetry/publisher";
import {
	OTLP_AUTH_HEADER_NAME,
	OTLP_AUTH_HEADER_VALUE,
	OTLP_ENDPOINT,
	OTLP_LOGGER_ENABLED,
	OTLP_LOGGER_LEVEL,
	WORKER_PROJECT_ID,
	WORKER_MODE,
	WORKER_GROUP_IDS,
	FLUXIFY_NODE_ID,
	MAX_REQUEST_BODY_BYTES,
	getEnv,
} from "../src/lib/env";
import {
	WORKFLOW_JOB,
	artifactKindsForMode,
	assertWorkerMode,
	jobKindsForMode,
} from "../src/modules/jobs/subjects";

/**
 * Trusted compiled-worker supervisor. It owns NATS and encrypted artifacts;
 * a separate child process owns user-code execution and can be replaced without
 * restarting this container or interrupting artifact hot reload.
 */
(BigInt.prototype as any).toJSON = function () {
	return this.toString();
};

const port = Number(getEnv("WORKER_PORT")) || 5600;
const healthPort = Number(getEnv("WORKER_HEALTH_PORT")) || port + 1;
const HEARTBEAT_CHECK_MS = 500;
/** Idle database integration timeout, supplied to the execution process. */
const databaseIdleTimeoutMs =
	Number(getEnv("INTEGRATION_TIMEOUT_POLICY_IN_SEC") || 450) * 1_000;
const asyncExecutor = asyncExecutorLimitsFromEnv();

initializeLogger({
	serviceName: "fluxify.worker.compiled",
	level: OTLP_LOGGER_LEVEL,
	otlpEndpoint: OTLP_ENDPOINT,
	otlpHeaders: { [OTLP_AUTH_HEADER_NAME]: OTLP_AUTH_HEADER_VALUE },
	useOtlp: OTLP_LOGGER_ENABLED === "true",
});

if (!WORKER_PROJECT_ID) {
	logger.error("WORKER_PROJECT_ID is required — set a project id, or * to serve every project");
	process.exit(1);
}
// A typo here must not quietly become `both` and start running work this
// deployment was never meant to take.
try {
	assertWorkerMode(WORKER_MODE);
} catch (error) {
	logger.error(String((error as Error).message));
	process.exit(1);
}
if (!getEnv("MASTER_ENCRYPTION_KEY")) {
	logger.error("MASTER_ENCRYPTION_KEY is required — project config artifacts are encrypted");
	process.exit(1);
}

const healthServer = Bun.serve({
	port: healthPort,
	fetch: (request) => healthResponse(request) ?? new Response(null, { status: 404 }),
});
logger.info(`supervisor health on http://${healthServer.hostname}:${healthPort}`);

const bundledProcess = new URL("./executionProcess.js", import.meta.url);
const processEntry = existsSync(bundledProcess)
	? bundledProcess
	: new URL("../src/modules/requestRouter/executionProcess.ts", import.meta.url);
const artifacts = new Map<string, ArtifactEntry>();
const timeoutProjects = new Map<string, boolean>();

const watchdog = new ExecutionWatchdog();
let execution: any;
let shuttingDown = false;
let terminatingForTimeout = false;
let watchdogTimer: ReturnType<typeof setInterval> | undefined;

function timeoutPolicyEnabled() {
	return [...timeoutProjects.values()].some(Boolean);
}

function updateTimeoutPolicy(key: string, value: unknown) {
	if (artifactKind(key) !== "project-config") return;
	if (!value) {
		const projectId = key.split(".")[1];
		if (projectId) timeoutProjects.delete(projectId);
		return;
	}
	const config = value as UnsealedProjectConfig;
	timeoutProjects.set(
		config.projectId,
		workerTimeoutsEnabled(config.payload.projectSettings),
	);
}

function synchronizeMonitoring() {
	const enabled = timeoutPolicyEnabled();
	watchdog.setEnabled(enabled);
	execution?.send({ type: "monitoring", enabled } satisfies ExecutionMessage);
	if (enabled && !watchdogTimer) {
		watchdogTimer = setInterval(evaluateTimeouts, HEARTBEAT_CHECK_MS);
	} else if (!enabled && watchdogTimer) {
		clearInterval(watchdogTimer);
		watchdogTimer = undefined;
	}
	logger.info(
		`experimental worker timeouts ${enabled ? "enabled" : "disabled"}`,
		"WORKER.timeout",
	);
}

/**
 * A child that dies right after starting would otherwise be respawned in a hot
 * loop, pinning a CPU. Quick deaths back off exponentially; a child that stayed
 * up for a while restarts at once.
 */
const STABLE_AFTER_MS = 10_000;
const MAX_RESTART_DELAY_MS = 30_000;
let restartDelayMs = 0;
let spawnedAt = 0;

function spawnExecution() {
	spawnedAt = Date.now();
	const bootstrap: ExecutionBootstrap = {
		projectId: WORKER_PROJECT_ID,
		port,
		databaseIdleTimeoutMs,
		asyncExecutor,
		artifacts: [...artifacts.values()].map(placed).filter((entry) => entry.value !== null),
		workerTimeoutsEnabled: timeoutPolicyEnabled(),
		maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
		logging: {
			level: OTLP_LOGGER_LEVEL,
			otlpEndpoint: OTLP_ENDPOINT,
			otlpHeaders: { [OTLP_AUTH_HEADER_NAME]: OTLP_AUTH_HEADER_VALUE },
			useOtlp: OTLP_LOGGER_ENABLED === "true",
		},
	};
	const child = Bun.spawn([process.execPath, fileURLToPath(processEntry)], {
		env: executionRuntimeEnvironment(),
		stdout: "inherit",
		stderr: "inherit",
		ipc: (event) => onExecutionEvent(event as ExecutionEvent),
		onExit: (process, exitCode, signalCode, error) => {
			if (execution !== process) return;
			execution = undefined;
			markNotReady();
			failPendingJobs("execution process exited mid-job");
			watchdog.setEnabled(timeoutPolicyEnabled());
			if (shuttingDown) return;
			const quick = Date.now() - spawnedAt < STABLE_AFTER_MS;
			restartDelayMs = quick ? Math.min(Math.max(restartDelayMs * 2, 500), MAX_RESTART_DELAY_MS) : 0;
			logger.error(
				`execution process exited (code=${exitCode}, signal=${signalCode}): ${error?.message ?? "restarting"} in ${restartDelayMs}ms`,
				"WORKER.execution",
			);
			terminatingForTimeout = false;
			setTimeout(() => {
				if (!shuttingDown && !execution) spawnExecution();
			}, restartDelayMs);
		},
	});
	execution = child;
	child.send({ type: "bootstrap", bootstrap } satisfies ExecutionMessage);
}

/**
 * Jobs handed to the execution process, waiting on its reply. The broker's ack
 * is driven by that reply, so a child that dies mid-job must reject its pending
 * work — otherwise the consumer sits on the message until the ack wait elapses.
 */
const pendingJobs = new Map<
	string,
	{ resolve: () => void; reject: (error: Error) => void }
>();

function runJobInExecution(job: JobEnvelope) {
	return new Promise<void>((resolve, reject) => {
		if (!execution) return reject(new Error("execution process is not running"));
		pendingJobs.set(job.id, { resolve, reject });
		execution.send({ type: "job", job } satisfies ExecutionMessage);
	});
}

/**
 * Where a queued job goes. A Trigger Workflow block is not queued work on the
 * jobs stream — it is an event on the triggers stream, and the only thing that
 * knows the difference is the kind the block used.
 */
function dispatchQueued(job: JobEnvelope) {
	if (job.kind !== TRIGGER_WORKFLOW_JOB) return enqueueJob(job);
	return fireInternalTrigger({
		id: job.id,
		projectId: job.projectId,
		workflowId: job.target,
		data: job.payload,
		origin: job.origin,
		retry: job.retry,
	});
}

function failPendingJobs(reason: string) {
	for (const [, pending] of pendingJobs) pending.reject(new Error(reason));
	pendingJobs.clear();
}

function onExecutionEvent(event: ExecutionEvent) {
	switch (event.type) {
		case "ready":
			markReady();
			logger.info("execution process ready", "WORKER.execution");
			return;
		case "job-finished": {
			const pending = pendingJobs.get(event.id);
			pendingJobs.delete(event.id);
			if (!pending) return;
			return event.error ? pending.reject(new Error(event.error)) : pending.resolve();
		}
		case "enqueue-job":
			// user code queued work; failures are logged, the graph moved on already
			return void dispatchQueued(event.job).catch((error) =>
				logger.error(
					`failed to queue ${event.job.kind}/${event.job.target}: ${String(error)}`,
					"WORKER.jobs",
				),
			);
		case "trace-finished":
			// The execution process holds untrusted user code (routes and workflows), never NATS credentials.
			return void publishTraceRun(event.run);
		case "trigger-fault": {
			// lost only if the admin is down; the child reports again on its next start
			const { type: _, ...fault } = event;
			return void rpcRequest(
				RPC_SUBJECTS.triggerFault,
				{ userId: "system", projectIds: [fault.projectId] },
				fault,
			).catch((error) =>
				logger.error(`could not report trigger ${fault.triggerId} fault: ${String(error)}`, "WORKER.triggers"),
			);
		}
		case "heartbeat":
			return watchdog.heartbeat();
		case "execution-started":
			return watchdog.start(event);
		case "execution-finished":
			return watchdog.finish(event.requestId);
	}
}

function handleArtifactChange(entry: ArtifactEntry) {
	const kind = artifactKind(entry.key);
	const policyChanged = kind === "project-config";
	if (entry.value === null) artifacts.delete(entry.key);
	else artifacts.set(entry.key, entry);

	if (kind === "trigger") return applyTrigger(placed(entry));

	if (policyChanged) updateTimeoutPolicy(entry.key, entry.value);
	execution?.send({ type: "artifact", entry } satisfies ExecutionMessage);
	if (policyChanged && execution) synchronizeMonitoring();
}

/**
 * A trigger as this worker sees it: withdrawn when it belongs to another node's
 * group or its connector's license can no longer run. The raw artifact stays in
 * `artifacts`, so a license renewed later — or a group handed to this node —
 * starts it again.
 */
function placed(entry: ArtifactEntry): ArtifactEntry {
	const trigger = entry.value as TriggerArtifact | null;
	if (artifactKind(entry.key) !== "trigger" || !trigger) return entry;
	return runsHere(trigger, node.groupIds, canRunConnectors(), node.excludedGroups)
		? entry
		: { key: entry.key, value: null };
}

/**
 * An internal trigger is consumed here, where the broker connection lives. An
 * external queue is consumed by the execution process beside its workflow;
 * forwarding its artifact is how this half starts and stops it. A withdrawal
 * names no type, so it goes to both — each ignores what it does not hold.
 */
function applyTrigger(entry: ArtifactEntry) {
	const trigger = entry.value as TriggerArtifact | null;
	const external = trigger ? consumedInExecution(trigger.type) : null;
	if (external !== false) {
		execution?.send({ type: "artifact", entry } satisfies ExecutionMessage);
	}
	if (external !== true) {
		void triggerWorker
			.apply(artifactId(entry.key), trigger)
			.catch((error) =>
				logger.error(
					`failed to apply trigger ${entry.key}: ${String(error)}`,
					"WORKER.triggers",
				),
			);
	}
}

/**
 * The ack wait for a trigger's consumer comes from the workflow it starts, and
 * the workflow artifact is already here.
 */
function workflowTimeoutSeconds(workflowId: string) {
	// Scanned rather than keyed: a catch-all worker (`WORKER_PROJECT_ID=*`) does
	// not know which project's key to build, and a worker holds few workflows.
	for (const [key, entry] of artifacts) {
		if (artifactKind(key) !== "workflow") continue;
		const artifact = entry.value as WorkflowArtifact | undefined;
		if (artifact?.workflowId === workflowId) return artifact.timeoutSeconds;
	}
	return undefined;
}

const triggerWorker = new TriggerWorker({
	projectId: WORKER_PROJECT_ID,
	run: runJobInExecution,
	workflowTimeoutSeconds,
	maxDeliver: Number(getEnv("JOBS_MAX_DELIVER")) || undefined,
	retryDelayMs: Number(getEnv("JOBS_RETRY_DELAY_MS")) || undefined,
});

// Feature flags and license state, pushed from the admin. Both exit on failure:
// a worker that cannot learn its edition would be guessing.
await watchInstanceSettings();
await watchLicense();

/**
 * Join the control plane before any consumer starts: what this node runs comes
 * from the orchestrator when something is orchestrating it and from the
 * environment when nothing is, and a worker the license has no room for must
 * exit without ever touching a queue.
 */
const attached = await attachNode({
	envNodeId: FLUXIFY_NODE_ID,
	projectId: WORKER_PROJECT_ID,
	envType: WORKER_MODE as NodeType,
	envGroupIds: WORKER_GROUP_IDS,
	entitlement: () => nodeEntitlement(),
	onGroupsChanged: () => replaceTriggers(),
	onStop: (reason, code) => {
		logger.warn(`${reason} — stopping`, "WORKER.node");
		void shutdown(reason, code);
	},
});
if (!attached.ok) {
	logger.error(
		`refusing to start: ${attached.refusal.message}. Stop a node, or raise the license tier.`,
		"WORKER.node",
	);
	process.exit(1);
}
const node = attached.node;
logger.info(`node ${node.slot.nodeId} holds a license slot — type ${node.type}`, "WORKER.node");

/**
 * Re-decides every trigger this worker holds. Needed whenever the answer to
 * "does this one run here" changes without the artifact changing — a license
 * flipping, or this node's groups being reassigned.
 */
function replaceTriggers() {
	for (const entry of artifacts.values()) {
		if (artifactKind(entry.key) === "trigger") applyTrigger(placed(entry));
	}
}

/**
 * A license lapsing past its grace, or being renewed, changes nothing in the
 * artifact store, so it is noticed here instead: the connectors are re-placed
 * whenever the answer flips.
 */
let canRunEnterprise = canRunConnectors();
const entitlementTimer = setInterval(() => {
	const canRun = canRunConnectors();
	if (canRun === canRunEnterprise) return;
	canRunEnterprise = canRun;
	logger.warn(
		`enterprise connectors ${canRun ? "resumed" : "stopped"} — license can${canRun ? "" : " no longer"} run them`,
		"WORKER.triggers",
	);
	replaceTriggers();
}, 60_000);

const artifactWatch = await watchProjectArtifacts(
	WORKER_PROJECT_ID,
	handleArtifactChange,
	artifactKindsForMode(node.type),
);
await artifactWatch.initialized;

spawnExecution();
synchronizeMonitoring();

/**
 * A consumer that will not start is not a degraded worker, it is a worker that
 * cannot do its job while reporting ready and passing health checks. The most
 * common cause is a leftover durable from an earlier run with a different
 * WORKER_PROJECT_ID: `FLUXIFY_JOBS` is work-queue, so overlapping filters are
 * refused, and this process would otherwise sit there while jobs pile up on a
 * subject nothing reads.
 */
function fatal(what: string, error: unknown): never {
	logger.error(
		`${what} failed to start, refusing to run without it: ${String(error)}`,
		"WORKER",
	);
	process.exit(1);
}

// Background work for this project. Separate from the request path on purpose:
// a queued job must not compete with traffic for the same acceptance.
await startJobWorker({
	projectId: WORKER_PROJECT_ID,
	mode: node.type,
	handle: runJobInExecution,
	concurrency: Number(getEnv("JOBS_CONCURRENCY")) || undefined,
	ackWaitMs: Number(getEnv("JOBS_ACK_WAIT_MS")) || undefined,
	maxDeliver: Number(getEnv("JOBS_MAX_DELIVER")) || undefined,
	retryDelayMs: Number(getEnv("JOBS_RETRY_DELAY_MS")) || undefined,
}).catch((error) => fatal("job worker", error));

// Triggers are the other half of the same story: the job worker takes work that
// was queued, this takes work that arrived.
await triggerWorker.start().catch((error) => fatal("trigger worker", error));

// Scheduled fires, on the workers that run workflows. The broker keeps the
// time; this turns each fire into a job. It belongs here rather than beside the
// reconciler on the control plane so that a control-plane node going down
// delays schedule *edits* and not the schedules themselves.
let fireConsumer: { stop(): Promise<void> } | undefined;
if (jobKindsForMode(node.type).includes(WORKFLOW_JOB)) {
	fireConsumer = await startFireConsumer({
		projectId: WORKER_PROJECT_ID,
		maxDeliver: Number(getEnv("JOBS_MAX_DELIVER")) || undefined,
		retryDelayMs: Number(getEnv("JOBS_RETRY_DELAY_MS")) || undefined,
	}).catch((error) => fatal("fire consumer", error));
}

function evaluateTimeouts() {
	const timedOut = watchdog.findTimedOut();
	if (!timedOut || !execution || terminatingForTimeout) return;
	terminatingForTimeout = true;
	logger.error(
		`terminating blocked execution process for route ${timedOut.routeId} after ${timedOut.timeoutMs}ms (heartbeat stalled ${Math.round(timedOut.stalledForMs)}ms)`,
		"WORKER.timeout",
	);
	// TODO(#195): emit a killed-execution span from the supervisor telemetry path.
	execution.kill();
}

node.serving();
logger.info(`compiled worker ready — isolated execution process on port ${port}`);

/**
 * Deprovisioning a node means draining it, in this order:
 *
 * readiness 503 first, so the load balancer stops sending new requests while
 * the ones in flight are still being answered; then the child finishes them;
 * then the license slot is handed back explicitly rather than waiting out its
 * TTL, or every rolling replace would stall for a lease.
 */
async function shutdown(sig: string, code = 0) {
	if (shuttingDown) return;
	shuttingDown = true;
	markDraining();
	if (watchdogTimer) clearInterval(watchdogTimer);
	clearInterval(entitlementTimer);
	logger.info(`received ${sig} — draining`);
	try {
		await fireConsumer?.stop();
		await triggerWorker.stop();
		if (!(await drainChild(execution, asyncExecutor))) {
			logger.warn("in-flight work did not finish before the drain deadline", "WORKER");
		}
		await node.stop();
		await artifactWatch.stop();
		healthServer.stop(true);
		await closeNats();
	} catch (error) {
		logger.error(`shutdown error: ${String(error)}`);
	} finally {
		process.exit(code);
	}
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
