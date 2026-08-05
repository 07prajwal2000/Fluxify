import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeLogger, logger } from "@fluxify/common";
import {
	healthResponse,
	markNotReady,
	markReady,
} from "../src/modules/requestRouter/health";
import {
	watchProjectArtifacts,
} from "../src/modules/requestRouter/artifactHost";
import type { UnsealedProjectConfig } from "../src/modules/compiler/artifacts";
import { artifactKind } from "../src/modules/compiler/subjects";
import type {
	ExecutionBootstrap,
	ExecutionEvent,
	ExecutionMessage,
} from "../src/modules/requestRouter/threadTypes";
import { ExecutionWatchdog } from "../src/modules/requestRouter/executionWatchdog";
import { workerTimeoutsEnabled } from "../src/modules/requestRouter/workerTimeouts";
import { asyncExecutorLimitsFromEnv } from "../src/modules/requestRouter/asyncExecutor";
import { executionRuntimeEnvironment } from "../src/modules/requestRouter/executionEnvironment";
import type { ArtifactEntry } from "../src/modules/requestRouter/compiledRuntime";
import { initializeRedis } from "../src/db/redis";
import { closePubSub, initializePubSub } from "../src/db/pubsub";
import {
	OTLP_AUTH_HEADER_NAME,
	OTLP_AUTH_HEADER_VALUE,
	OTLP_ENDPOINT,
	OTLP_LOGGER_ENABLED,
	OTLP_LOGGER_LEVEL,
	WORKER_PROJECT_ID,
	getEnv,
} from "../src/lib/env";

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
if (!getEnv("MASTER_ENCRYPTION_KEY")) {
	logger.error("MASTER_ENCRYPTION_KEY is required — project config artifacts are encrypted");
	process.exit(1);
}

const healthServer = Bun.serve({
	port: healthPort,
	fetch: (request) => healthResponse(request) ?? new Response(null, { status: 404 }),
});
logger.info(`supervisor health on http://${healthServer.hostname}:${healthPort}`);

initializeRedis();
await initializePubSub();

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

function spawnExecution() {
	const bootstrap: ExecutionBootstrap = {
		projectId: WORKER_PROJECT_ID,
		port,
		databaseIdleTimeoutMs,
		asyncExecutor,
		artifacts: [...artifacts.values()],
		workerTimeoutsEnabled: timeoutPolicyEnabled(),
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
			watchdog.setEnabled(timeoutPolicyEnabled());
			if (shuttingDown) return;
			logger.error(
				`execution process exited (code=${exitCode}, signal=${signalCode}): ${error?.message ?? "restarting"}`,
				"WORKER.execution",
			);
			terminatingForTimeout = false;
			spawnExecution();
		},
	});
	execution = child;
	child.send({ type: "bootstrap", bootstrap } satisfies ExecutionMessage);
}

function onExecutionEvent(event: ExecutionEvent) {
	switch (event.type) {
		case "ready":
			markReady();
			logger.info("execution process ready", "WORKER.execution");
			return;
		case "heartbeat":
			return watchdog.heartbeat();
		case "execution-started":
			return watchdog.start(event);
		case "execution-finished":
			return watchdog.finish(event.requestId);
	}
}

function handleArtifactChange(entry: ArtifactEntry) {
	const policyChanged = artifactKind(entry.key) === "project-config";
	if (entry.value === null) artifacts.delete(entry.key);
	else artifacts.set(entry.key, entry);
	if (policyChanged) updateTimeoutPolicy(entry.key, entry.value);
	execution?.send({ type: "artifact", entry } satisfies ExecutionMessage);
	if (policyChanged && execution) synchronizeMonitoring();
}

const artifactWatch = await watchProjectArtifacts(
	WORKER_PROJECT_ID,
	handleArtifactChange,
);
await artifactWatch.initialized;

spawnExecution();
synchronizeMonitoring();

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

logger.info(`compiled worker ready — isolated execution process on port ${port}`);

async function shutdown(sig: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	if (watchdogTimer) clearInterval(watchdogTimer);
	logger.info(`received ${sig} — shutting down`);
	try {
		execution?.kill();
		artifactWatch.stop();
		healthServer.stop(true);
		await closePubSub();
	} catch (error) {
		logger.error(`shutdown error: ${String(error)}`);
	} finally {
		process.exit(0);
	}
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
