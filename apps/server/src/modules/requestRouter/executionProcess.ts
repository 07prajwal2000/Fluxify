import { setJobEnqueuer, setScheduleHorizon, setTriggerPayloadLimit } from "@fluxify/blocks";
import { initializeLogger, logger } from "@fluxify/common";
import { projectSettingsCache } from "../../loaders/projectSettingsLoader";
import { artifactKind } from "../compiler/subjects";
import { registerCustomBlockJobHandler } from "../jobs/customBlockJob";
import { runJob } from "../jobs/registry";
import type { JobEnvelope } from "../jobs/types";
import { registerWorkflowJobHandler } from "../jobs/workflowJob";
import { exportTraceRun, resetProviders } from "../telemetry/destinations";
import { RouteTraceRecorder, WorkflowTraceRecorder } from "../telemetry/routeRecorder";
import { triggerPayloadLimit } from "../triggers/payloadLimit";
import { setTriggerFaultReporter } from "../triggers/queueRuntime.ee";
import { AsyncExecutor } from "./asyncExecutor";
import {
	applyArtifactUpdate,
	compiledRouteValidators,
	fromPortal,
	initCompiledRuntime,
	routeParserFor,
	setBaseDomain,
	setTrustedOrigins,
	shutdownCompiledRuntime,
} from "./compiledRuntime";
import { executionRuntimeEnvironment } from "./executionEnvironment";
import { createHttpContext } from "./httpContext";
import { dispatch, envelopeFromHttp, type RouteExecutionObserver } from "./service";
import type { ExecutionBootstrap, ExecutionEvent, ExecutionMessage } from "./threadTypes";
import { workerTimeoutsEnabled } from "./workerTimeouts";

let boot: ExecutionBootstrap | undefined;
let monitoringEnabled = false;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let ready = false;
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
		// a rotated credential or moved endpoint must not keep exporting through
		// providers built from the old config
		if (artifactKind(message.entry.key) === "project-config") void resetProviders();
		return;
	}
	if (message.type === "job") return void executeJob(message.job);
	if (message.type === "base-domain") return setBaseDomain(message.baseDomain);
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
	setBaseDomain(boot.baseDomain);
	setTrustedOrigins(boot.trustedOrigins);
	initCompiledRuntime(boot.artifacts, boot.databaseIdleTimeoutMs);
	ready = true;
	asyncExecutor = new AsyncExecutor(boot.asyncExecutor, (error) =>
		logger.error(`async dispatch failed: ${String(error)}`, "WORKER.execution"),
	);
	setMonitoring(boot.workerTimeoutsEnabled);
	registerCustomBlockJobHandler();
	registerWorkflowJobHandler({
		start(workflow) {
			return new WorkflowTraceRecorder(workflow, exportTraceRun);
		},
	});
	// The cap is read per publish rather than captured once: project settings
	// arrive over the artifact watch and change while the process is running.
	setTriggerPayloadLimit(triggerPayloadLimit);
	setScheduleHorizon(boot.scheduleHorizonMs);
	setTriggerFaultReporter((fault) => send({ type: "trigger-fault", ...fault }));
	// This process holds no broker connection: queueing is a message to the
	// supervisor, which owns NATS.
	setJobEnqueuer((request) =>
		send({
			type: "enqueue-job",
			job: {
				...request,
				// a scheduled run already handed its id back to the graph
				id: request.id ?? crypto.randomUUID(),
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

/**
 * The portal's playground calls a project's subdomain from the base domain, so
 * it is cross-origin. Only the portal is let through; every other origin sees
 * the routes exactly as before, with whatever CORS the route itself sets.
 */
async function handle(request: Request): Promise<Response> {
	const origin = request.headers.get("origin");
	if (!fromPortal(origin)) return serveRoute(request);
	const cors = {
		"access-control-allow-origin": origin!,
		vary: "Origin",
	};
	if (request.method === "OPTIONS" && request.headers.has("access-control-request-method")) {
		return new Response(null, {
			status: 204,
			headers: {
				...cors,
				"access-control-allow-methods": "GET, POST, PUT, DELETE",
				"access-control-allow-headers": request.headers.get("access-control-request-headers") ?? "",
				"access-control-max-age": "600",
			},
		});
	}
	const response = await serveRoute(request);
	for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
	// the playground shows response headers, which the browser hides otherwise
	response.headers.set("access-control-expose-headers", "*");
	return response;
}

async function serveRoute(request: Request): Promise<Response> {
	if (!ready) return new Response("Execution process is not ready", { status: 503 });
	// resolved before anything else: the host decides which project's routes exist
	const parser = routeParserFor(request.headers.get("host") ?? undefined);
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
			return new RouteTraceRecorder(route, exportTraceRun);
		},
	};

	if (env.trigger.reply === "async") {
		const accepted = asyncExecutor?.submit(async () => {
			// The HTTP response is already a 202. Do not retain the HTTP context or
			// attempt late cookie/header writes while the detached route runs.
			await dispatch(env, parser, undefined, observer, compiledRouteValidators, traceFactory);
		});
		if (!accepted) {
			return json({ message: "Async execution capacity is full" }, 429, ctx.responseHeaders);
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
	// Not `stop(true)`: that cuts off requests already being served, which is
	// exactly what draining exists to avoid. New connections stop either way.
	await server?.stop();
	const drained = await asyncExecutor?.drain();
	if (drained === false) {
		logger.warn("async executor drain deadline elapsed", "WORKER.execution");
	}
	await shutdownCompiledRuntime();
	// shutdown flushes: queued spans and metrics get one attempt at the wire
	await resetProviders().catch(() => {});
	process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
