import { logger } from "@fluxify/common";
import { initializeAIWorkflow } from "./workflow";
import { loadAppConfig, loadIntegrations } from "@fluxify/server";
import { initDocsDB } from "./db/vector";
import { initializeHarnessWorker } from "./harness/worker";

export async function runWorker() {
	logger.info("Starting worker process...", "Worker");
	await initDocsDB();
	await loadAppConfig();
	await loadIntegrations();
	initializeAIWorkflow();
	await initializeHarnessWorker();
	logger.info("Worker process started successfully.", "Worker");
}
