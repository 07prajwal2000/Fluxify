import { logger } from "@fluxify/common";
import { consumeQueue, natsConnection, type QueueMessage } from "@fluxify/common/nats";
import { initializePubSub } from "@fluxify/server";
import { HARNESS_CONCURRENT_JOBS } from "../lib/env";
import {
	HARNESS_CONSUMER,
	HARNESS_STREAM,
	initializeHarnessQueue,
	type HarnessJobData,
} from "./queue";
import { AgentFactory } from "./models/factory";
import {
	resolveAgentOptionsFromIntegrationId,
	resolveAgentOptionsFromProjectId,
} from "./models/projectConfig";
import { FluxifyHarness, type HarnessRunContext } from "./index";
import { HarnessService } from "./internal/harnessService";
import { subscribeInterrupts } from "./interrupt";

let stop: (() => Promise<void>) | null = null;

/**
 * Consumes harness jobs off the JetStream work queue and drives each one
 * through the graph. Runs in the gateway worker thread (see worker.ts ->
 * runWorker); several gateway replicas share one durable consumer, so this
 * scales out by starting more of them.
 */
export async function initializeHarnessWorker() {
	if (stop) return stop;

	// The worker publishes progress to NATS (`conversations.<userId>`); ensure the
	// pub/sub client is connected before any job runs. Idempotent.
	await initializePubSub();
	await initializeHarnessQueue();
	// Listen for user interrupt requests targeting runs on this worker.
	await subscribeInterrupts();

	const consumer = await consumeQueue<HarnessJobData>(
		natsConnection(),
		HARNESS_STREAM,
		HARNESS_CONSUMER,
		runJob,
		{
			concurrency: HARNESS_CONCURRENT_JOBS,
			// The queue never redelivers (maxDeliver 1), so holding the ack for the
			// length of a run would buy nothing but an ack_wait heartbeat to
			// maintain. Acking on dispatch also means a slot is what limits
			// concurrency, not the consumer's pull window.
			ack: "on-dispatch",
			onError: (_error, job) => {
				if (job) void releaseRun(job.data);
			},
		},
	);
	stop = consumer.stop;

	logger.info(
		`Initialized (concurrency ${HARNESS_CONCURRENT_JOBS})`,
		"HarnessWorker",
	);
	return stop;
}

async function runJob({ data }: QueueMessage<HarnessJobData>) {
	const projectId = data.metadata?.projectId;
	if (!projectId) {
		throw new Error("Harness job missing projectId; cannot resolve AI config");
	}

	// Idempotency gate. Nothing past this point is cheap or repeatable, so a
	// duplicate delivery is dropped here rather than after a model call.
	const service = new HarnessService(data.conversationId);
	const claimed =
		data.type === "continue"
			? await service.claimRun(data.runId, "awaiting_hitl", "executing")
			: await service.claimRun(data.runId, "queued", "routing");
	if (!claimed) {
		logger.warn("[HarnessWorker] Skipping job; run is not claimable", {
			runId: data.runId,
			conversationId: data.conversationId,
			type: data.type,
			idempotencyKey: data.idempotencyKey,
		});
		return;
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
	};

	logger.info("[HarnessWorker] Processing job", {
		type: data.type,
		conversationId: data.conversationId,
		runId: data.runId,
	});

	if (data.type === "continue") {
		await harness.continue(ctx);
		return;
	}
	await harness.start(ctx);
}

/**
 * Frees a conversation whose job threw before the harness took over its own
 * error handling (a missing projectId, an unresolvable integration). Without
 * this the claim taken above would leave the conversation `running` forever
 * with nothing to finish it, and the user could never send another message.
 */
async function releaseRun(data: HarnessJobData) {
	try {
		const service = new HarnessService(data.conversationId);
		await service.updateRun({ runId: data.runId, status: "failed" });
		await service.updateConversationStatus("failed");
	} catch (error) {
		logger.error("[HarnessWorker] Failed to release run", {
			runId: data.runId,
			error,
		});
	}
}

/** Exported for tests: the job handler without the consumer around it. */
export const __runJob = runJob;
export const __releaseRun = releaseRun;
