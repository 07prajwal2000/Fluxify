import { initVectorDB } from "./db/vector";
import { loadEmbeddingModel } from "./lib/embedding-model";
import { logger } from "@fluxify/common";
import { initializeAIWorkflow } from "./workflow";
import { loadAppConfig, loadIntegrations } from "@fluxify/server";

export async function runWorker() {
	logger.info("[Worker] Starting worker process...");
	await loadAppConfig();
	await loadIntegrations();
	await loadEmbeddingModel();
	await initVectorDB();
	initializeAIWorkflow();
	logger.info("[Worker] Worker process started successfully.");
}
