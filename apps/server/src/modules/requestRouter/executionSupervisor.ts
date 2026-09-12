import { fileURLToPath } from "node:url";
import { logger } from "@fluxify/common";
import { TRIGGER_WORKFLOW_JOB } from "@fluxify/blocks";
import { RPC_SUBJECTS, rpcRequest } from "../../db/natsRpc";
import { enqueueJob } from "../jobs/publisher";
import type { JobEnvelope } from "../jobs/types";
import { publishTraceRun } from "../telemetry/publisher";
import { fireInternalTrigger } from "../triggers/publisher";
import type { AsyncExecutorLimits } from "./asyncExecutor";
import type { ArtifactEntry } from "./compiledRuntime";
import { executionRuntimeEnvironment } from "./executionEnvironment";
import { ExecutionWatchdog } from "./executionWatchdog";
import { markNotReady, markReady } from "./health";
import type {
	ExecutionBootstrap,
	ExecutionEvent,
	ExecutionMessage,
} from "./threadTypes";

/**
 * Owns the child process that runs user code.
 *
 * The split exists because the child is the untrusted half: it holds routes and
 * workflows and never holds NATS credentials, so everything it cannot be
 * trusted with — queueing work, publishing traces, reporting faults — happens
 * on this side of the IPC channel. Keeping that here also means the child can
 * be replaced without restarting the container or interrupting artifact hot
 * reload, which is the whole point of spawning it separately.
 */

/** How often the watchdog looks for a stalled execution. */
const HEARTBEAT_CHECK_MS = 500;

/**
 * A child that dies right after starting would otherwise be respawned in a hot
 * loop, pinning a CPU. Quick deaths back off exponentially; a child that stayed
 * up for a while restarts at once.
 */
const STABLE_AFTER_MS = 10_000;
const MAX_RESTART_DELAY_MS = 30_000;

export interface ExecutionSupervisorOptions {
	projectId: string;
	/** Where the child serves user traffic. */
	port: number;
	/** The child's entry point, bundled or source. */
	entry: URL;
	databaseIdleTimeoutMs: number;
	asyncExecutor: AsyncExecutorLimits;
	maxRequestBodyBytes: number;
	logging: ExecutionBootstrap["logging"];
	/** The artifacts a freshly spawned child should start with, as this node sees them. */
	artifacts: () => ArtifactEntry[];
	/** Whether any project loaded here asks for execution timeouts. */
	timeoutsEnabled: () => boolean;
}

export interface ExecutionSupervisor {
	/** Spawns the child. Respawns on its own after a crash until `stop()`. */
	start(): void;
	/** Forwards a message, reporting whether a child was there to take it. */
	send(message: ExecutionMessage): boolean;
	/** Runs a queued job in the child and resolves when it reports back. */
	runJob(job: JobEnvelope): Promise<void>;
	/** Re-reads the timeout policy and starts or stops watching for stalls. */
	synchronizeMonitoring(): void;
	/** The running child, for a drain on shutdown. */
	child(): { kill(): void; exited: Promise<unknown> } | undefined;
	/** Stops respawning. The child itself is drained by the caller. */
	stop(): void;
}

export function createExecutionSupervisor(
	options: ExecutionSupervisorOptions,
): ExecutionSupervisor {
	const watchdog = new ExecutionWatchdog();
	let execution: any;
	let stopping = false;
	let terminatingForTimeout = false;
	let watchdogTimer: ReturnType<typeof setInterval> | undefined;
	let restartDelayMs = 0;
	let spawnedAt = 0;

	/**
	 * Jobs handed to the child, waiting on its reply. The broker's ack is driven
	 * by that reply, so a child that dies mid-job must reject its pending work —
	 * otherwise the consumer sits on the message until the ack wait elapses.
	 */
	const pendingJobs = new Map<
		string,
		{ resolve: () => void; reject: (error: Error) => void }
	>();

	function failPendingJobs(reason: string) {
		for (const [, pending] of pendingJobs) pending.reject(new Error(reason));
		pendingJobs.clear();
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

	function onEvent(event: ExecutionEvent) {
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
				// The child holds untrusted user code, never NATS credentials.
				return void publishTraceRun(event.run);
			case "trigger-fault": {
				// lost only if the admin is down; the child reports again on its next start
				const { type: _, ...fault } = event;
				return void rpcRequest(
					RPC_SUBJECTS.triggerFault,
					{ userId: "system", projectIds: [fault.projectId] },
					fault,
				).catch((error) =>
					logger.error(
						`could not report trigger ${fault.triggerId} fault: ${String(error)}`,
						"WORKER.triggers",
					),
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

	function spawn() {
		spawnedAt = Date.now();
		const bootstrap: ExecutionBootstrap = {
			projectId: options.projectId,
			port: options.port,
			databaseIdleTimeoutMs: options.databaseIdleTimeoutMs,
			asyncExecutor: options.asyncExecutor,
			artifacts: options.artifacts(),
			workerTimeoutsEnabled: options.timeoutsEnabled(),
			maxRequestBodyBytes: options.maxRequestBodyBytes,
			logging: options.logging,
		};
		const child = Bun.spawn([process.execPath, fileURLToPath(options.entry)], {
			env: executionRuntimeEnvironment(),
			stdout: "inherit",
			stderr: "inherit",
			ipc: (event) => onEvent(event as ExecutionEvent),
			onExit: (process, exitCode, signalCode, error) => {
				if (execution !== process) return;
				execution = undefined;
				markNotReady();
				failPendingJobs("execution process exited mid-job");
				watchdog.setEnabled(options.timeoutsEnabled());
				if (stopping) return;
				const quick = Date.now() - spawnedAt < STABLE_AFTER_MS;
				restartDelayMs = quick
					? Math.min(Math.max(restartDelayMs * 2, 500), MAX_RESTART_DELAY_MS)
					: 0;
				logger.error(
					`execution process exited (code=${exitCode}, signal=${signalCode}): ${error?.message ?? "restarting"} in ${restartDelayMs}ms`,
					"WORKER.execution",
				);
				terminatingForTimeout = false;
				setTimeout(() => {
					if (!stopping && !execution) spawn();
				}, restartDelayMs);
			},
		});
		execution = child;
		child.send({ type: "bootstrap", bootstrap } satisfies ExecutionMessage);
	}

	return {
		start: spawn,

		send(message) {
			execution?.send(message);
			return Boolean(execution);
		},

		runJob(job) {
			return new Promise<void>((resolve, reject) => {
				if (!execution) return reject(new Error("execution process is not running"));
				pendingJobs.set(job.id, { resolve, reject });
				execution.send({ type: "job", job } satisfies ExecutionMessage);
			});
		},

		synchronizeMonitoring() {
			const enabled = options.timeoutsEnabled();
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
		},

		child: () => execution,

		stop() {
			stopping = true;
			if (watchdogTimer) clearInterval(watchdogTimer);
		},
	};
}
