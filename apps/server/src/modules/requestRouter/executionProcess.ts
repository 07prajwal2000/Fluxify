import { setJobEnqueuer, setScheduleHorizon, setTriggerPayloadLimit } from "@fluxify/blocks";
import { initializeLogger, logger } from "@fluxify/common";
import type { HttpRoute } from "@fluxify/lib";
import "../../lib/bigintJson";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { projectSettingsCache } from "../../loaders/projectSettingsLoader";
import { artifactKind } from "../compiler/subjects";
import { registerCustomBlockJobHandler } from "../jobs/customBlockJob";
import { runJob } from "../jobs/registry";
import type { JobEnvelope } from "../jobs/types";
import { registerWorkflowJobHandler } from "../jobs/workflowJob";
import { exportTraceRun, resetProviders } from "../telemetry/destinations";
import { RouteTraceRecorder, WorkflowTraceRecorder } from "../telemetry/routeRecorder";
import { triggerPayloadLimit } from "../triggers/payloadLimit";
import { setTriggerFaultReporter } from "../triggers/queueRuntime";
import { AsyncExecutor } from "./asyncExecutor";
import {
	applyArtifactUpdate,
	compiledRouteValidators,
	devRequest,
	fromPortal,
	initCompiledRuntime,
	routeParserFor,
	sandboxRequest,
	setBaseDomain,
	setTrustedOrigins,
	shutdownCompiledRuntime,
} from "./compiledRuntime";
import { DEBUG_ERROR_HEADER, debugError, debugRequested, encodeDebugError } from "./debugError";
import { DEBUG_TRACE_HEADER, encodeDebugTrace } from "./debugTrace";
import { DEV_TOKEN_HEADER } from "./devToken";
import { executionRuntimeEnvironment } from "./executionEnvironment";
import { createHttpContext } from "./httpContext";
import { loadPluginIntegrations } from "./pluginIntegrations";
import { setPluginRefs } from "./pluginLoader";
import {
	dispatch,
	envelopeFromHttp,
	type RouteExecutionObserver,
	type RouteTraceFactory,
} from "./service";
import type { ExecutionBootstrap, ExecutionEvent, ExecutionMessage } from "./threadTypes";
import type { TraceSinks } from "./traceLifecycle";
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
	if (message.type === "bootstrap") {
		return void bootstrap(message.bootstrap).catch((error) => {
			logger.error(`execution process failed to start: ${String(error)}`, "WORKER.execution");
			process.exit(1);
		});
	}
	if (message.type === "artifact") {
		applyArtifactUpdate(message.entry.key, message.entry.value);
		// a rotated credential or moved endpoint must not keep exporting through
		// providers built from the old config
		if (artifactKind(message.entry.key) === "project-config") void resetProviders();
		return;
	}
	if (message.type === "job") return void executeJob(message.job);
	if (message.type === "base-domain") return setBaseDomain(message.baseDomain);
	if (message.type === "plugin-refs") {
		setPluginRefs(message.refs);
		// a newly installed plugin's variants; failures are logged and fail at use
		return void loadPluginIntegrations(message.integrations);
	}
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

async function bootstrap(nextBoot: ExecutionBootstrap) {
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
	setPluginRefs(boot.pluginRefs);
	// before the artifacts: the factories resolve a plugin variant by its registration (I6)
	await loadPluginIntegrations(boot.pluginIntegrations);
	// plugin code is imported before ready, so no request meets a half-loaded route
	await initCompiledRuntime(boot.artifacts, boot.databaseIdleTimeoutMs);
	ready = true;
	asyncExecutor = new AsyncExecutor(boot.asyncExecutor, (error) =>
		logger.error(`async dispatch failed: ${String(error)}`, "WORKER.execution"),
	);
	setMonitoring(boot.workerTimeoutsEnabled);
	registerCustomBlockJobHandler();
	registerWorkflowJobHandler({
		start(workflow) {
			return new WorkflowTraceRecorder(workflow, finishRun(workflow));
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
	const host =
		!server.hostname || server.hostname === "0.0.0.0" || server.hostname === "::"
			? "localhost"
			: server.hostname;
	logger.info(`[execution] serving on http://${host}:${server.port}`, "WORKER.execution");
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
	const ctx = createHttpContext(request);
	const host = request.headers.get("host") ?? undefined;
	const devToken = request.headers.get(DEV_TOKEN_HEADER);
	// a sandbox (#735) or a development route (#736): both need the dev token
	const scoped =
		sandboxRequest(ctx.req.path, devToken, host) ??
		devRequest(ctx.req.path, host, devToken, boot?.env);
	if (scoped && scoped.status !== 200) {
		const message =
			scoped.status === 404 ? "Route not found" : "Missing or wrong development token";
		return json({ message }, scoped.status, ctx.responseHeaders);
	}
	// resolved before anything else: the host decides which project's routes exist
	const parser = scoped?.parser ?? routeParserFor(host);
	const env = await envelopeFromHttp(ctx as any);
	if (scoped) {
		// blocks see the path after the prefix, and never the token
		env.payload.path = scoped.path;
		delete env.payload.headers[DEV_TOKEN_HEADER];
	}
	const debug = debugRequested(env, parser, boot?.debugKey);
	const observer = createObserver();
	// an admin debug call also keeps the run, to answer with a short trace
	let debugRun: TraceRunPayload | undefined;
	const traceFactory: RouteTraceFactory = {
		start(route) {
			const finish = finishRun(route);
			return new RouteTraceRecorder(route, (run) => {
				if (debug && !run.parentRunId) debugRun = run;
				finish(run);
			});
		},
	};

	if (env.trigger.reply === "async") {
		// A detached run cannot hand a live request stream to user code: the
		// request is gone once the 202 is sent. Refuse before accepting it.
		const matched = parser.getRouteId(env.payload.path, env.payload.method as HttpRoute["method"]);
		if (matched?.bodyMode === "stream") {
			return json(
				{ message: "Streaming request bodies cannot be used with async replies" },
				400,
				ctx.responseHeaders,
			);
		}
		// The route, if any, is buffered before the request outlives its reply.
		await env.payload.bodyReader?.materialize();
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
		if (debug && response.error !== undefined) addDebugError(ctx.responseHeaders, response.error);
		if (debugRun) addDebugTrace(ctx.responseHeaders, debugRun);
		return json(response.data, response.status, ctx.responseHeaders);
	} catch (error) {
		if (debug) addDebugError(ctx.responseHeaders, error);
		if (debugRun) addDebugTrace(ctx.responseHeaders, debugRun);
		return json(
			{ message: error?.toString() || "Internal server error" },
			500,
			ctx.responseHeaders,
		);
	}
}

/**
 * OTLP export only with tracing on, a recording only with recording on (#254).
 * A recording goes to the supervisor, which owns NATS; the send is fire and
 * forget, so the request never waits on it.
 */
function finishRun(sinks: TraceSinks) {
	return (run: TraceRunPayload) => {
		if (sinks.tracingEnabled) exportTraceRun(run);
		if (sinks.recordExecution) send({ type: "record-run", run });
	};
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

/** the real error, for the admin's debug call only (#671); the body stays generic */
function addDebugError(headers: Headers, error: unknown) {
	// a debug aid must never fail the response it rides on (#672)
	try {
		headers.set(DEBUG_ERROR_HEADER, encodeDebugError(debugError(error)));
	} catch {}
}

/** the blocks that ran, for the admin's debug call only (#704) */
function addDebugTrace(headers: Headers, run: TraceRunPayload) {
	try {
		headers.set(DEBUG_TRACE_HEADER, encodeDebugTrace(run.spans, run.runId));
	} catch {}
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
