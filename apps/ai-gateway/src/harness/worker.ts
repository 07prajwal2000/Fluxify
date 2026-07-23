import { Worker } from "bullmq";
import { logger } from "@fluxify/common";
import { REDIS_HOST, REDIS_PASS, REDIS_PORT, REDIS_USER } from "../lib/env";
import { HARNESS_QUEUE_NAME, type HarnessJobData } from "./queue";
import { AgentFactory } from "./models/factory";
import { resolveAgentOptionsFromProjectId } from "./models/projectConfig";
import { FluxifyHarness, type HarnessRunContext } from "./index";

let worker: Worker<HarnessJobData> | null = null;

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

			const projectId = data.metadata?.projectId;
			if (!projectId) {
				throw new Error("Harness job missing projectId; cannot resolve AI config");
			}

			// AI provider/keys come from the user's configured integration, never env.
			const agentOptions = await resolveAgentOptionsFromProjectId(projectId);
			const harness = new FluxifyHarness(
				new AgentFactory({ ...agentOptions, maxToolIterations: 20 }),
			);
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
