import "./instrumentation";
import { isMainThread, Worker } from "worker_threads";
import { runMain } from "./main";
import { runWorker } from "./worker";
import { initializeLogger } from "@fluxify/common";
import {
	OTLP_ENDPOINT,
	OTLP_LOGGER_LEVEL,
	OTLP_AUTH_HEADER_VALUE,
	OTLP_AUTH_HEADER_NAME,
	OTLP_LOGGER_ENABLED,
} from "./lib/env";
import { drizzleInit, initializeRedis } from "@fluxify/server";
import { initializeWorkflowQueue } from "./workflow/queue";

initializeLogger({
	serviceName: isMainThread
		? "fluxify.api-gateway-main"
		: "fluxify.api-gateway-worker",
	level: OTLP_LOGGER_LEVEL,
	otlpEndpoint: OTLP_ENDPOINT,
	otlpHeaders: { [OTLP_AUTH_HEADER_NAME]: OTLP_AUTH_HEADER_VALUE },
	useOtlp: OTLP_LOGGER_ENABLED === "true",
});
initializeRedis(true);
await drizzleInit(false);

initializeWorkflowQueue();

if (isMainThread) {
	// Spawn the worker thread targeting index.ts
	new Worker(import.meta.filename);
	await runMain();
} else {
	await runWorker();
}
