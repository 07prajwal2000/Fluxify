import { Worker } from "bullmq";
import { logger } from "@fluxify/common";
import { initializePubSub } from "@fluxify/server";
import { REDIS_HOST, REDIS_PASS, REDIS_PORT, REDIS_USER } from "../lib/env";
import { HARNESS_QUEUE_NAME, type HarnessJobData } from "./queue";
import { AgentFactory } from "./models/factory";
import {
	resolveAgentOptionsFromIntegrationId,
	resolveAgentOptionsFromProjectId,
} from "./models/projectConfig";
import { FluxifyHarness, type HarnessRunContext } from "./index";
import { subscribeInterrupts } from "./interrupt";

let worker: Worker<HarnessJobData> | null = null;

/**
 * Starts the BullMQ worker that consumes harness jobs and drives a run through
 * the graph. Runs in the gateway worker thread (see worker.ts -> runWorker).
 */
export async function initializeHarnessWorker() {
	if (worker) return worker;

	// The worker publishes progress to NATS (`conversations.<userId>`); ensure the
	// pub/sub client is connected before any job runs. Idempotent.
	await initializePubSub();
	// Listen for user interrupt requests targeting runs on this worker.
	await subscribeInterrupts();

	worker = new Worker<HarnessJobData>(
		HARNESS_QUEUE_NAME,
		async (job) => {
			const data = job.data;

			const projectId = data.metadata?.projectId;
			if (!projectId) {
				throw new Error("Harness job missing projectId; cannot resolve AI config");
			}

			// AI provider/keys come from the run's picked integration (never env);
			// fall back to the project default when the user didn't choose one.
			const integrationId = data.metadata?.integrationId;
			const agentOptions = integrationId
				? resolveAgentOptionsFromIntegrationId(integrationId)
				: await resolveAgentOptionsFromProjectId(projectId);
			// No maxToolIterations override — the wrapper default (8) is already
			// well above what a correct sub-agent run needs (2-4). Reaching the
			// cap means the agent is thrashing, and every iteration costs a full
			// round trip carrying the whole history.
			const harness = new FluxifyHarness(new AgentFactory(agentOptions));
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

	logger.info("Initialized", "HarnessWorker");
	return worker;
}
