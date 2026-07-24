import { serve } from "bun";
import { Hono } from "hono";
import { initializeLogger, logger } from "@fluxify/common";
import { initWorker } from "../src/modules/requestRouter/worker";
import { mapRouter } from "../src/modules/requestRouter/router";
import {
	OTLP_AUTH_HEADER_NAME,
	OTLP_AUTH_HEADER_VALUE,
	OTLP_ENDPOINT,
	OTLP_LOGGER_ENABLED,
	OTLP_LOGGER_LEVEL,
} from "../src/lib/env";

// JSON has no BigInt type; DB bigint columns break JSON.stringify (and c.json).
// Serialize as string — same fix the admin server applies.
(BigInt.prototype as any).toJSON = function () {
	return this.toString();
};

const port = Number(process.env.WORKER_PORT) || 5600;

initializeLogger({
	serviceName: "fluxify.worker",
	level: OTLP_LOGGER_LEVEL,
	otlpEndpoint: OTLP_ENDPOINT,
	otlpHeaders: { [OTLP_AUTH_HEADER_NAME]: OTLP_AUTH_HEADER_VALUE },
	useOtlp: OTLP_LOGGER_ENABLED === "true",
});

const parser = await initWorker();

// HTTP is the only wired transport for now. To add NATS/BullMQ later, build a
// RequestEnvelope from the incoming message and call dispatch(env, parser) —
// see src/modules/requestRouter/service.ts. The runtime above stays unchanged.
const app = new Hono();
await mapRouter(app, parser);

const server = serve({ fetch: app.fetch, port });
logger.info(
	`request worker running at http://${server.hostname}:${server.port}`,
);
