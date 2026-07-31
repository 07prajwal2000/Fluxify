import { workerData, parentPort } from "node:worker_threads";
import { initializeLogger, logger } from "@fluxify/common";
import { initCompiledRuntime, applyArtifactUpdate } from "./compiledRuntime";
import { createHttpContext } from "./httpContext";
import { dispatch, envelopeFromHttp } from "./service";
import type { ThreadBootstrap, ThreadMessage } from "./threadTypes";

/**
 * An execution thread: binds the shared port, serves requests, runs compiled
 * user code.
 *
 * It opens no connections. NATS, Redis and the encryption key stay in the
 * supervisor, so a user script that re-imports our modules in this thread finds
 * them uninitialised — a worker thread gets its own module registry, which is
 * what makes that hold. Everything this thread needs arrives in workerData at
 * spawn, and later updates come over postMessage.
 */

const boot = workerData as ThreadBootstrap;

// Nothing here reads env — config arrives in workerData. Clear it before any
// user code can run, so `process.env` is not a way around the above.
for (const key of Object.keys(process.env)) delete process.env[key];
process.env = {};
// argv carries no secret today, but a deploy that ever passes one as a flag
// would leak it the same way — clear it here rather than remembering not to.
process.argv = [];
process.execArgv = [];

initializeLogger({
	serviceName: `fluxify.worker.thread.${boot.threadId}`,
	level: boot.logging.level,
	otlpEndpoint: boot.logging.otlpEndpoint,
	otlpHeaders: boot.logging.otlpHeaders,
	useOtlp: boot.logging.useOtlp,
});

const parser = initCompiledRuntime(boot.artifacts);

parentPort?.on("message", (message: ThreadMessage) => {
	if (message.type === "artifact") {
		applyArtifactUpdate(message.entry.key, message.entry.value);
	}
});

const server = Bun.serve({
	port: boot.port,
	// every thread binds the same port; the kernel picks which one gets each
	// connection, so no request is passed between threads
	reusePort: true,
	fetch: handle,
});

async function handle(request: Request): Promise<Response> {
	const ctx = createHttpContext(request);
	const env = await envelopeFromHttp(ctx as any);

	// fire-and-forget triggers ack immediately and run detached
	if (env.trigger.reply === "async") {
		queueMicrotask(() =>
			dispatch(env, parser).catch((e) =>
				logger.error(`async dispatch failed: ${e?.toString()}`),
			),
		);
		return json({ accepted: true, id: env.trigger.id }, 202, ctx.responseHeaders);
	}

	try {
		const response = await dispatch(env, parser, ctx as any);
		return json(response.data, response.status, ctx.responseHeaders);
	} catch (error) {
		return json(
			{ message: error?.toString() || "Internal server error" },
			500,
			ctx.responseHeaders,
		);
	}
}

function json(data: unknown, status: number, headers: Headers) {
	headers.set("content-type", "application/json");
	return new Response(JSON.stringify(data), { status, headers });
}

parentPort?.postMessage({ type: "ready", threadId: boot.threadId });
logger.info(
	`[thread ${boot.threadId}] serving port ${server.port}`,
	"WORKER.thread",
);
