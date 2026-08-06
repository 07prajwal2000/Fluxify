import { initializeLogger, logger } from "@fluxify/common";
import { drizzleInit } from "../src/db";
import { initializeNats, closeNats, natsConnected } from "../src/db/nats";
// project settings are read through the redis-backed cache
import { initializeRedis } from "../src/db/redis";
import { loadIntegrations } from "../src/loaders/integrationsLoader";
import { loadAppConfig } from "../src/loaders/appconfigLoader";
import { startTelemetryWorker } from "../src/modules/telemetry/consumer";
import { resetProviders } from "../src/modules/telemetry/destinations";
import { getEnv } from "../src/lib/env";

/**
 * Telemetry worker. Drains recorded runs off NATS and exports them to each
 * project's OTLP destination.
 *
 * Admin-plane, like the compiler: it holds NATS and a database connection
 * because it has to resolve integration credentials, and it runs no user code.
 * Deliberately nothing on the request path — killing this process must have zero
 * effect on traffic serving.
 */

const healthPort = Number(getEnv("TELEMETRY_HEALTH_PORT")) || 5700;

initializeLogger({ serviceName: "fluxify.worker.telemetry" });

await drizzleInit();
initializeRedis();
await initializeNats();
await loadAppConfig();
await loadIntegrations();
await startTelemetryWorker();

const healthServer = Bun.serve({
	port: healthPort,
	fetch: (request) => {
		const path = new URL(request.url).pathname;
		if (path === "/health" || path === "/ready") {
			return natsConnected()
				? Response.json({ status: "ok" })
				: Response.json({ status: "nats disconnected" }, { status: 503 });
		}
		return new Response(null, { status: 404 });
	},
});

logger.info(`telemetry worker ready — health on http://${healthServer.hostname}:${healthPort}`);

let shuttingDown = false;
async function shutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info(`received ${signal} — shutting down`);
	try {
		healthServer.stop(true);
		// shutdown flushes, so anything already queued to a batch processor still
		// gets one attempt at the wire before the process goes away
		await resetProviders();
		await closeNats();
	} catch (error) {
		logger.error(`shutdown error: ${String(error)}`);
	} finally {
		process.exit(0);
	}
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
