import { logger } from "@fluxify/common";
import { consumeQueue, natsConnection } from "@fluxify/common/nats";
import { aiIntegrationsCache, db, getProjectSetting, ownsIntegration } from "@fluxify/server";
import { mintAgentToken } from "@fluxify/server/src/lib/agentToken";
import { HARNESS_CONCURRENT_JOBS } from "../../lib/env";
import { httpAdminFetch } from "../../mcp/adminApi";
import { modelFromIntegration } from "../model";
import { agentStore } from "../store";
import { limitsFromProject } from "../timeouts";
import { agentTools } from "../tools";
import { executeRun, type RunDeps } from "./job";
import {
	AGENT_CONSUMER,
	AGENT_STREAM,
	type AgentJob,
	initializeAgentQueue,
	publishRunEvents,
	subscribeStops,
} from "./queue";
import { claimRun, settleConversation } from "./repository";

const LIMIT_KEYS = [
	"settings.ai.maxSteps",
	"settings.ai.tokenBudget",
	"settings.ai.maxContextTokens",
] as const;

/**
 * The agent for one job: the project's AI integration and limits (#661), and
 * tools that call the admin API with a fresh run token for the job's user in
 * the job's project. The session cookie never reaches the worker.
 */
export const buildAgent: RunDeps["build"] = async (job) => {
	const integrationId = await getProjectSetting(job.projectId, "settings.ai.agentConnectionId");
	const integration = aiIntegrationsCache[integrationId];
	if (!integration || !ownsIntegration(integration, job.projectId))
		throw new Error(
			"This project has no AI integration for the agent. Pick one in the project's AI settings.",
		);
	const settings: Record<string, string> = {};
	for (const key of LIMIT_KEYS) settings[key] = await getProjectSetting(job.projectId, key);
	const token = mintAgentToken(job.userId, job.projectId);
	const { tools, active } = agentTools(
		httpAdminFetch,
		{ authorization: `Bearer ${token}` },
		job.projectId,
	);
	return {
		model: modelFromIntegration(integration),
		tools,
		active,
		projectId: job.projectId,
		limits: limitsFromProject(settings, process.env),
		mode: job.mode,
	};
};

/** conversationId → the run this worker holds for it. */
const running = new Map<string, AbortController>();

const deps: RunDeps = {
	store: agentStore(db),
	claimRun,
	settle: settleConversation,
	build: buildAgent,
	publish: publishRunEvents,
	onError: (error) => logger.error("[AgentRunner] run side step failed", { error }),
};

async function runJob({ data }: { data: AgentJob }) {
	const ctrl = new AbortController();
	running.set(data.conversationId, ctrl);
	try {
		const status = await executeRun(data, deps, ctrl.signal);
		logger.info("[AgentRunner] job done", { runId: data.runId, type: data.type, status });
	} finally {
		running.delete(data.conversationId);
	}
}

/** Consumes agent jobs in the gateway worker thread. Replicas share the durable consumer. */
export async function initializeAgentWorker() {
	await initializeAgentQueue();
	await subscribeStops((conversationId) =>
		running.get(conversationId)?.abort(new Error("Stopped by user")),
	);
	await consumeQueue<AgentJob>(natsConnection(), AGENT_STREAM, AGENT_CONSUMER, runJob, {
		concurrency: HARNESS_CONCURRENT_JOBS,
		// maxDeliver 1: acking on dispatch holds no ack open for a whole run.
		ack: "on-dispatch",
		// The job threw before executeRun settled it (e.g. the claim query): free the conversation.
		onError: (error, job) => {
			logger.error("[AgentRunner] job failed", { error });
			if (job)
				void Promise.all([
					deps.store.setRunStatus(job.data.runId, "failed"),
					settleConversation(job.data.conversationId, job.data.runId, "failed"),
				]).catch(deps.onError);
		},
	});
	logger.info(`Initialized (concurrency ${HARNESS_CONCURRENT_JOBS})`, "AgentRunner");
}
