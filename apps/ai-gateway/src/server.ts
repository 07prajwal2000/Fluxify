import "./tracing";
import { initializeLogger } from "@fluxify/common";
import { isMainThread, Worker } from "worker_threads";
import {
	OTLP_AUTH_HEADER_NAME,
	OTLP_AUTH_HEADER_VALUE,
	OTLP_ENDPOINT,
	OTLP_LOGGER_ENABLED,
	OTLP_LOGGER_LEVEL,
	validateEnv,
} from "./lib/env";
import { runMain } from "./main";
import { runWorker } from "./worker";

validateEnv();

import { drizzleInit, initializePubSub, initializeRedis } from "@fluxify/server";
import { initializeHarnessQueue } from "./harness/queue";

const serviceName = isMainThread ? "fluxify.api-gateway-main" : "fluxify.api-gateway-worker";

initializeLogger({
	serviceName,
	level: OTLP_LOGGER_LEVEL,
	otlpEndpoint: OTLP_ENDPOINT,
	otlpHeaders: { [OTLP_AUTH_HEADER_NAME]: OTLP_AUTH_HEADER_VALUE },
	useOtlp: OTLP_LOGGER_ENABLED === "true",
});
initializeRedis(true);
await initializePubSub();
await drizzleInit(false);

await initializeHarnessQueue();

if (isMainThread) {
	// Spawn the worker thread targeting index.ts
	new Worker(import.meta.filename);
	await runMain();
} else {
	await runWorker();
}
