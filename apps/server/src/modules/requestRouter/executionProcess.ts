import { initializeLogger, logger } from "@fluxify/common";
import { setJobEnqueuer } from "@fluxify/blocks";
import { createHttpContext } from "./httpContext";
import { registerCustomBlockJobHandler } from "../jobs/customBlockJob";
import { runJob } from "../jobs/registry";
import type { JobEnvelope } from "../jobs/types";
import {
	applyArtifactUpdate,
	compiledRouteValidators,
	initCompiledRuntime,
	shutdownCompiledRuntime,
} from "./compiledRuntime";
import { dispatch, envelopeFromHttp, type RouteExecutionObserver } from "./service";
import type {
	ExecutionBootstrap,
	ExecutionEvent,
	ExecutionMessage,
} from "./threadTypes";
import { projectSettingsCache } from "../../loaders/projectSettingsLoader";
import { workerTimeoutsEnabled } from "./workerTimeouts";
import { AsyncExecutor } from "./asyncExecutor";
import { executionRuntimeEnvironment } from "./executionEnvironment";
import { RouteTraceRecorder } from "../telemetry/routeRecorder";

let boot: ExecutionBootstrap | undefined;
let monitoringEnabled = false;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let parser: ReturnType<typeof initCompiledRuntime> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let shuttingDown = false;
let asyncExecutor: AsyncExecutor | undefined;

// The child process never needs supervisor secrets. Preserve only the Windows
// compatibility value Bun needs for networking before compiled user code loads.
process.env = executionRuntimeEnvironment();
process.argv = [];
process.execArgv = [];

process.on("message", (message: ExecutionMessage) => {
	if (message.type === "bootstrap") return bootstrap(message.bootstrap);
	if (message.type === "artifact") {
		applyArtifactUpdate(message.entry.key, message.entry.value);
		return;
	}
	if (message.type === "job") return void executeJob(message.job);
	setMonitoring(message.enabled);
});

/**
 * The supervisor acks the message on the reply, so every path must send one —
 * a swallowed error here stalls the job until its ack wait elapses.
 */
async function executeJob(job: JobEnvelope) {
	try {
		await runJob(job);
		send({ type: "job-finished", id: job.id });
	} catch (error) {
		send({ type: "job-finished", id: job.id, error: String(error) });
	}
}

function bootstrap(nextBoot: ExecutionBootstrap) {
	if (boot) throw new Error("execution process was bootstrapped twice");
	boot = nextBoot;
	initializeLogger({
		serviceName: "fluxify.worker.execution",
		level: boot.logging.level,
		otlpEndpoint: boot.logging.otlpEndpoint,
		otlpHeaders: boot.logging.otlpHeaders,
		useOtlp: boot.logging.useOtlp,
	});
	parser = initCompiledRuntime(boot.artifacts, boot.databaseIdleTimeoutMs);
	asyncExecutor = new AsyncExecutor(boot.asyncExecutor, (error) =>
		logger.error(`async dispatch failed: ${String(error)}`, "WORKER.execution"),
	);
	setMonitoring(boot.workerTimeoutsEnabled);
	registerCustomBlockJobHandler();
	// This process holds no broker connection: queueing is a message to the
	// supervisor, which owns NATS.
	setJobEnqueuer((request) =>
		send({
			type: "enqueue-job",
			job: {
				...request,
				id: crypto.randomUUID(),
				enqueuedAt: new Date().toISOString(),
			},
		}),
	);

	server = Bun.serve({
		port: boot.port,
		reusePort: true,
		// hard ceiling: Bun rejects a larger body before user code ever sees it
		maxRequestBodySize: boot.maxRequestBodyBytes,
		fetch: handle,
	});
	send({ type: "ready" });
	logger.info(`[execution] serving port ${server.port}`, "WORKER.execution");
}

async function handle(request: Request): Promise<Response> {
	if (!parser) return new Response("Execution process is not ready", { status: 503 });
	const ctx = createHttpContext(request);
	const env = await envelopeFromHttp(ctx as any);
	const observer = createObserver();
	const traceFactory = {
		start(route: {
			routeId: string;
			projectId: string;
			routeVersion: string;
			method: string;
			path: string;
		}) {
			return new RouteTraceRecorder(route, (run) =>
				send({ type: "trace-finished", run }),
			);
		},
	};

	if (env.trigger.reply === "async") {
		const accepted = asyncExecutor?.submit(async () => {
			// The HTTP response is already a 202. Do not retain the HTTP context or
			// attempt late cookie/header writes while the detached route runs.
			await dispatch(
				env,
				parser!,
				undefined,
				observer,
				compiledRouteValidators,
				traceFactory,
			);
		});
		if (!accepted) {
			return json(
				{ message: "Async execution capacity is full" },
				429,
				ctx.responseHeaders,
			);
		}
		return json({ accepted: true, id: env.trigger.id }, 202, ctx.responseHeaders);
	}

	try {
		const response = await dispatch(
			env,
			parser,
			ctx as any,
		observer,
		compiledRouteValidators,
		traceFactory,
	);
		return json(response.data, response.status, ctx.responseHeaders);
	} catch (error) {
		return json(
			{ message: error?.toString() || "Internal server error" },
			500,
			ctx.responseHeaders,
		);
	}
}

function createObserver(): RouteExecutionObserver | undefined {
	if (!monitoringEnabled) return;
	return {
		onRouteStart(route) {
			if (!workerTimeoutsEnabled(projectSettingsCache[route.projectId])) return;
			const requestId = crypto.randomUUID();
			send({
				type: "execution-started",
				requestId,
				routeId: route.routeId,
				timeoutMs: route.timeoutSeconds * 1_000,
			});
			return () => send({ type: "execution-finished", requestId });
		},
	};
}

function setMonitoring(enabled: boolean) {
	monitoringEnabled = enabled;
	if (heartbeat) clearInterval(heartbeat);
	heartbeat = undefined;
	if (enabled) {
		heartbeat = setInterval(() => send({ type: "heartbeat" }), 500);
	}
}

function send(event: ExecutionEvent) {
	process.send?.(event);
}

function json(data: unknown, status: number, headers: Headers) {
	headers.set("content-type", "application/json");
	return new Response(JSON.stringify(data), { status, headers });
}

async function shutdown() {
	if (shuttingDown) return;
	shuttingDown = true;
	if (heartbeat) clearInterval(heartbeat);
	server?.stop(true);
	const drained = await asyncExecutor?.drain();
	if (drained === false) {
		logger.warn("async executor drain deadline elapsed", "WORKER.execution");
	}
	await shutdownCompiledRuntime();
	process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
