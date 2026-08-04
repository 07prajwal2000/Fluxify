import { initializeLogger, logger } from "@fluxify/common";
import { createHttpContext } from "./httpContext";
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

let boot: ExecutionBootstrap | undefined;
let monitoringEnabled = false;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let parser: ReturnType<typeof initCompiledRuntime> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let shuttingDown = false;
let asyncExecutor: AsyncExecutor | undefined;

// The child process never needs supervisor secrets. Clear inherited values
// before compiled user code is instantiated.
for (const key of Object.keys(process.env)) delete process.env[key];
process.env = {};
process.argv = [];
process.execArgv = [];

process.on("message", (message: ExecutionMessage) => {
	if (message.type === "bootstrap") return bootstrap(message.bootstrap);
	if (message.type === "artifact") {
		applyArtifactUpdate(message.entry.key, message.entry.value);
		return;
	}
	setMonitoring(message.enabled);
});

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

	server = Bun.serve({ port: boot.port, reusePort: true, fetch: handle });
	send({ type: "ready" });
	logger.info(`[execution] serving port ${server.port}`, "WORKER.execution");
}

async function handle(request: Request): Promise<Response> {
	if (!parser) return new Response("Execution process is not ready", { status: 503 });
	const ctx = createHttpContext(request);
	const env = await envelopeFromHttp(ctx as any);
	const observer = createObserver();

	if (env.trigger.reply === "async") {
		const accepted = asyncExecutor?.submit(async () => {
			// The HTTP response is already a 202. Do not retain the HTTP context or
			// attempt late cookie/header writes while the detached route runs.
			await dispatch(env, parser!, undefined, observer, compiledRouteValidators);
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
