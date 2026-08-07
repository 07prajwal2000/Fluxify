import { serve } from "bun";
import { Hono } from "hono";
import { initializeLogger, logger } from "@fluxify/common";
import { initWorker } from "../src/modules/requestRouter/worker";
import { mapRouter } from "../src/modules/requestRouter/router";
import {
	markReady,
	registerHealthRoutes,
} from "../src/modules/requestRouter/health";
import { closePubSub } from "../src/db/pubsub";
import {
	OTLP_AUTH_HEADER_NAME,
	OTLP_AUTH_HEADER_VALUE,
	OTLP_ENDPOINT,
	OTLP_LOGGER_ENABLED,
	OTLP_LOGGER_LEVEL,
	MAX_REQUEST_BODY_BYTES,
	getEnv,
} from "../src/lib/env";

// JSON has no BigInt type; DB bigint columns break JSON.stringify (and c.json).
// Serialize as string — same fix the admin server applies.
(BigInt.prototype as any).toJSON = function () {
	return this.toString();
};

const port = Number(getEnv("WORKER_PORT")) || 5600;

initializeLogger({
	serviceName: "fluxify.worker",
	level: OTLP_LOGGER_LEVEL,
	otlpEndpoint: OTLP_ENDPOINT,
	otlpHeaders: { [OTLP_AUTH_HEADER_NAME]: OTLP_AUTH_HEADER_VALUE },
	useOtlp: OTLP_LOGGER_ENABLED === "true",
});

// Serve immediately so the startup probe answers while deps load; the ready
// probe returns 503 until initWorker() finishes and markReady() flips it.
const app = new Hono();
registerHealthRoutes(app);

const server = serve({
	fetch: app.fetch,
	port,
	maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
});
logger.info(
	`request worker running at http://${server.hostname}:${server.port}`,
);

// Graceful shutdown — registered BEFORE the (slow) initWorker() so a stop during
// startup is honored too. As PID 1 the process must install its OWN handlers:
// the kernel drops default-disposition signals for PID 1, so without these
// SIGTERM/SIGINT are ignored and `docker stop` hangs until SIGKILL. Stop the
// server, drain NATS, then hard-exit (open sockets would otherwise keep us up).
let shuttingDown = false;
async function shutdown(sig: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info(`received ${sig} — shutting down`);
	try {
		server.stop(true);
		await closePubSub();
	} catch (e) {
		logger.error(`shutdown error: ${e?.toString()}`);
	} finally {
		process.exit(0);
	}
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

const parser = await initWorker();

// HTTP is the only wired transport for now. To add NATS/BullMQ later, build a
// RequestEnvelope from the incoming message and call dispatch(env, parser) —
// see src/modules/requestRouter/service.ts. The runtime above stays unchanged.
await mapRouter(app, parser);
markReady();
logger.info("request worker ready — dependencies loaded");
