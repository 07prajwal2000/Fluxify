import { logger } from "@fluxify/common";
import { loadAppConfig, loadIntegrations } from "@fluxify/server";
import { initializeAgentWorker } from "./agent/runner/worker";
import { initKnowledgeBase } from "./db/knowledge";
import { initDocsDB } from "./db/vector";

export async function runWorker() {
	logger.info("Starting worker process...", "Worker");
	await initDocsDB();
	await initKnowledgeBase();
	await loadAppConfig();
	await loadIntegrations();
	await initializeAgentWorker();
	logger.info("Worker process started successfully.", "Worker");
}
