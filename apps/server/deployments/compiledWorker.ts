import { existsSync } from "node:fs";
import { initializeLogger, logger } from "@fluxify/common";
import { healthResponse, markDraining } from "../src/modules/requestRouter/health";
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
import type { ExecutionMessage } from "../src/modules/requestRouter/threadTypes";
import { workerTimeoutsEnabled } from "../src/modules/requestRouter/workerTimeouts";
import { asyncExecutorLimitsFromEnv, drainChild } from "../src/modules/requestRouter/asyncExecutor";
import { createExecutionSupervisor } from "../src/modules/requestRouter/executionSupervisor";
import type { ArtifactEntry } from "../src/modules/requestRouter/compiledRuntime";
import { closeNats } from "../src/db/nats";
import { watchInstanceSettings } from "../src/loaders/instanceSettingsLoader";
import { canRunConnectors, nodeEntitlement, watchLicense } from "../src/lib/edition";
import { attachNode } from "../src/modules/orchestrator/node";
import type { NodeType } from "@fluxify/common/orchestrator";
import { createJobWorker, type JobWorker } from "../src/modules/jobs/consumer";
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
let shuttingDown = false;

/**
 * Projects this worker holds artifacts for — one on a pinned deployment, and
 * every project that exists on a catch-all (`WORKER_PROJECT_ID=*`) one.
 *
 * It exists because broker consumers are per project and never per deployment:
 * `FLUXIFY_JOBS` and `FLUXIFY_TRIGGERS` are work-queue streams, so a wildcard
 * consumer overlaps every per-project one and JetStream refuses the second
 * (`filtered consumer not unique on workqueue stream`) — which would mean a
 * catch-all worker and a project's own claimed node could never run at once.
 * So the artifact watch, which already knows every project this worker serves,
 * is what decides which consumers exist.
 */
const servedProjects = new Set<string>();
/** Set once the initial artifact replay is in and consumers are being started. */
let servingProjects = false;

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
	timeoutProjects.set(config.projectId, workerTimeoutsEnabled(config.payload.projectSettings));
}

/** The child that runs user code. It owns its own crash recovery. */
const supervisor = createExecutionSupervisor({
	projectId: WORKER_PROJECT_ID,
	port,
	entry: processEntry,
	databaseIdleTimeoutMs,
	asyncExecutor,
	maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
	logging: {
		level: OTLP_LOGGER_LEVEL,
		otlpEndpoint: OTLP_ENDPOINT,
		otlpHeaders: { [OTLP_AUTH_HEADER_NAME]: OTLP_AUTH_HEADER_VALUE },
		useOtlp: OTLP_LOGGER_ENABLED === "true",
	},
	// placed, because a trigger this node does not run must not reach the child
	artifacts: () => [...artifacts.values()].map(placed).filter((entry) => entry.value !== null),
	timeoutsEnabled: timeoutPolicyEnabled,
});

function handleArtifactChange(entry: ArtifactEntry) {
	const kind = artifactKind(entry.key);
	const policyChanged = kind === "project-config";
	if (entry.value === null) artifacts.delete(entry.key);
	else artifacts.set(entry.key, entry);
	// Keys are `<kind>.<projectId>.<id>`, so this is also how a catch-all worker
	// learns that a project exists at all.
	trackProject(entry);

	if (kind === "trigger") return applyTrigger(placed(entry));

	if (policyChanged) updateTimeoutPolicy(entry.key, entry.value);
	const delivered = supervisor.send({ type: "artifact", entry } satisfies ExecutionMessage);
	if (policyChanged && delivered) supervisor.synchronizeMonitoring();
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
		supervisor.send({ type: "artifact", entry } satisfies ExecutionMessage);
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

/**
 * Notes the project an artifact belongs to, and starts or stops its consumers.
 *
 * During the initial replay nothing is started — the set is collected and
 * served in one pass below, so that a failure there stops the boot instead of
 * being logged by a worker that then reports ready.
 */
function trackProject(entry: ArtifactEntry) {
	const projectId = entry.key.split(".")[1];
	if (!projectId) return;
	if (entry.value === null) return unserveIfGone(projectId);
	if (servedProjects.has(projectId)) return;
	servedProjects.add(projectId);
	if (!servingProjects) return;
	void serveProject(projectId).catch((error) => {
		// Dropped from the set so this project's next artifact tries again. One
		// project's consumer failing must not take down the others' work.
		servedProjects.delete(projectId);
		logger.error(
			`consumers for ${projectId} failed to start: ${String(error)}`,
			"WORKER",
		);
	});
}

/** Both of this project's broker consumers: queued work, and arriving work. */
async function serveProject(projectId: string) {
	await jobWorker.serve(projectId);
	await triggerWorker.serveInternal(projectId);
}

/**
 * The project's last artifact went away — it was deleted, or handed to another
 * node. Consuming for it would mean holding work nothing here can run.
 */
function unserveIfGone(projectId: string) {
	if (!servedProjects.has(projectId)) return;
	for (const key of artifacts.keys())
		if (key.split(".")[1] === projectId) return;
	servedProjects.delete(projectId);
	void Promise.all([
		jobWorker.unserve(projectId),
		triggerWorker.unserveInternal(projectId),
	]).catch((error) =>
		logger.error(
			`consumers for ${projectId} failed to stop: ${String(error)}`,
			"WORKER",
		),
	);
}

const triggerWorker = new TriggerWorker({
	projectId: WORKER_PROJECT_ID,
	run: supervisor.runJob,
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
 * Built here, before the artifact watch: the watch is what tells it which
 * projects to serve, and the node's type is what decides which job kinds it
 * takes. Nothing is consumed until the replay is in.
 */
const jobWorker: JobWorker = createJobWorker({
	mode: node.type,
	handle: supervisor.runJob,
	concurrency: Number(getEnv("JOBS_CONCURRENCY")) || undefined,
	ackWaitMs: Number(getEnv("JOBS_ACK_WAIT_MS")) || undefined,
	maxDeliver: Number(getEnv("JOBS_MAX_DELIVER")) || undefined,
	retryDelayMs: Number(getEnv("JOBS_RETRY_DELAY_MS")) || undefined,
});

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

supervisor.start();
supervisor.synchronizeMonitoring();

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

// Triggers are the other half of the story the job worker starts: that one
// takes work that was queued, this takes work that arrived. The stream — and
// the sweep of any wildcard consumer an older build left behind — is provisioned
// here, so it comes before the first project is served.
await triggerWorker.start().catch((error) => fatal("trigger worker", error));

// Background work, per project. Separate from the request path on purpose: a
// queued job must not compete with traffic for the same acceptance.
for (const projectId of servedProjects)
	await serveProject(projectId).catch((error) =>
		fatal(`consumers for project ${projectId}`, error),
	);
servingProjects = true;
logger.info(
	`serving ${servedProjects.size} project(s) as a ${node.type} node${WORKER_PROJECT_ID === "*" ? " (catch-all)" : ""}`,
	"WORKER",
);

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
	supervisor.stop();
	clearInterval(entitlementTimer);
	logger.info(`received ${sig} — draining`);
	try {
		await jobWorker.stop();
		await fireConsumer?.stop();
		await triggerWorker.stop();
		if (!(await drainChild(supervisor.child(), asyncExecutor))) {
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
