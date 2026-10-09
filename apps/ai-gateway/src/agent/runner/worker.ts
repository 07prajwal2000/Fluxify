import { logger } from "@fluxify/common";
import { consumeQueue, natsConnection } from "@fluxify/common/nats";
import { db, getProjectSetting } from "@fluxify/server";
import { mintAgentToken } from "@fluxify/server/src/lib/agentToken";
import { AGENT_CONCURRENT_JOBS } from "../../lib/env";
import { httpAdminFetch } from "../../mcp/adminApi";
import { modelFromIntegration } from "../model";
import { agentStore } from "../store";
import { limitsFromProject } from "../timeouts";
import { agentTools } from "../tools";
import { executeCompact } from "./compactJob";
import { agentIntegration } from "./integration";
import { executeRun, type RunDeps } from "./job";
import { startHeartbeat } from "./orphans";
import {
	AGENT_CONSUMER,
	AGENT_STREAM,
	type AgentJob,
	initializeAgentQueue,
	publishRunEvents,
	subscribeHeld,
	subscribeStops,
} from "./queue";
import { addRunUsage, claimRun, settleConversation, touchRun } from "./repository";

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
export const buildAgent: RunDeps["build"] = async (job, loaded) => {
	const integration = await agentIntegration(job.projectId);
	if (!integration)
		throw new Error(
			"This project has no AI integration for the agent. Pick one in the project's AI settings.",
		);
	const settings: Record<string, string> = {};
	for (const key of LIMIT_KEYS) settings[key] = await getProjectSetting(job.projectId, key);
	const token = mintAgentToken(job.userId, job.projectId);
	const { tools, active, load } = agentTools(
		httpAdminFetch,
		{ authorization: `Bearer ${token}` },
		job.projectId,
		loaded,
	);
	return {
		model: modelFromIntegration(integration),
		tools,
		active,
		load,
		projectId: job.projectId,
		limits: limitsFromProject(settings, process.env),
		mode: job.mode,
		effort: job.effort,
	};
};

/** conversationId → the run this worker holds for it. */
const running = new Map<string, { runId: string; ctrl: AbortController }>();

/** Read per job: `db` is only set once drizzleInit ran, after this module loaded. */
export const deps: RunDeps = {
	get store() {
		return agentStore(db);
	},
	claimRun,
	settle: settleConversation,
	build: buildAgent,
	publish: publishRunEvents,
	addUsage: addRunUsage,
	onError: (error) => logger.error("[AgentRunner] run side step failed", { error }),
};

async function runJob({ data }: { data: AgentJob }) {
	const ctrl = new AbortController();
	running.set(data.conversationId, { runId: data.runId, ctrl });
	// The run row is the proof of life; a run released under us stops here.
	const stopBeat = startHeartbeat(
		() => touchRun(data.runId),
		() => ctrl.abort(new Error("The run was released")),
	);
	try {
		const status = await (data.type === "compact" ? executeCompact : executeRun)(
			data,
			deps,
			ctrl.signal,
		);
		logger.info("[AgentRunner] job done", { runId: data.runId, type: data.type, status });
	} finally {
		stopBeat();
		running.delete(data.conversationId);
	}
}

/** Consumes agent jobs in the gateway worker thread. Replicas share the durable consumer. */
export async function initializeAgentWorker() {
	await initializeAgentQueue();
	await subscribeStops((conversationId) =>
		running.get(conversationId)?.ctrl.abort(new Error("Stopped by user")),
	);
	subscribeHeld((runId) => [...running.values()].some((r) => r.runId === runId));
	await consumeQueue<AgentJob>(natsConnection(), AGENT_STREAM, AGENT_CONSUMER, runJob, {
		concurrency: AGENT_CONCURRENT_JOBS,
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
	logger.info(`Initialized (concurrency ${AGENT_CONCURRENT_JOBS})`, "AgentRunner");
}
