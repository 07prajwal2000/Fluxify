import { Worker } from "bullmq";
import { logger } from "@fluxify/common";
import { REDIS_HOST, REDIS_PASS, REDIS_PORT, REDIS_USER } from "../lib/env";
import { HARNESS_QUEUE_NAME, type HarnessJobData } from "./queue";
import { AgentFactory, type AgentProvider } from "./models/factory";
import { FluxifyHarness, type HarnessRunContext } from "./index";

let worker: Worker<HarnessJobData> | null = null;

/** Builds the LLM agent factory from env (defaults mirror demo.ts). */
function createAgentFactory(): AgentFactory {
	return new AgentFactory({
		provider: (process.env.HARNESS_LLM_PROVIDER as AgentProvider) || "mistral",
		modelName: process.env.HARNESS_LLM_MODEL || "mistral-medium-3-5",
		apiKey:
			process.env.HARNESS_LLM_API_KEY ||
			process.env.MISTRAL_API_KEY ||
			"cBTsofirRdO6gJpPH2n0TRcIiZgJI4Ih",
		maxToolIterations: 20,
	});
}

/**
 * Starts the BullMQ worker that consumes harness jobs and drives a run through
 * the graph. Runs in the gateway worker thread (see worker.ts -> runWorker).
 */
export function initializeHarnessWorker() {
	if (worker) return worker;

	worker = new Worker<HarnessJobData>(
		HARNESS_QUEUE_NAME,
		async (job) => {
			const data = job.data;
			const harness = new FluxifyHarness(createAgentFactory());
			const ctx: HarnessRunContext = {
				conversationId: data.conversationId,
				runId: data.runId,
				query: data.query,
				action: data.action,
				metadata: data.metadata,
				job,
			};

			logger.info("[HarnessWorker] Processing job", {
				jobId: job.id,
				type: data.type,
				conversationId: data.conversationId,
				runId: data.runId,
			});

			if (data.type === "continue") {
				return await harness.continue(ctx);
			}
			return await harness.start(ctx);
		},
		{
			connection: {
				host: REDIS_HOST,
				port: parseInt(REDIS_PORT),
				password: REDIS_PASS,
				username: REDIS_USER,
			},
		},
	);

	worker.on("failed", (job, err) => {
		logger.error("[HarnessWorker] Job failed", {
			jobId: job?.id,
			conversationId: job?.data?.conversationId,
			error: err,
		});
	});

	logger.info("[HarnessWorker] Initialized");
	return worker;
}
