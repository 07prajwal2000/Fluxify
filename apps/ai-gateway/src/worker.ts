import { logger } from "@fluxify/common";
import { loadAppConfig, loadIntegrations } from "@fluxify/server";
import { initializeAgentWorker } from "./agent/runner/worker";
import { initDocsDB } from "./db/vector";
import { initializeHarnessWorker } from "./harness/worker";

export async function runWorker() {
	logger.info("Starting worker process...", "Worker");
	await initDocsDB();
	await loadAppConfig();
	await loadIntegrations();
	await initializeHarnessWorker();
	await initializeAgentWorker();
	logger.info("Worker process started successfully.", "Worker");
}
