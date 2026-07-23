import { generateID } from "@fluxify/lib";
import { HarnessService, type HitlPlanAction } from "./harnessService";
import { RedisService } from "./redisService";
import {
	harnessQueue,
	HARNESS_START_JOB,
	HARNESS_CONTINUE_JOB,
	type HarnessJobMetadata,
} from "../queue";

export interface EnqueueStartParams {
	/** Reuse an existing conversation, or omit to create a fresh one. */
	conversationId?: string;
	query: string;
	metadata?: HarnessJobMetadata;
}

export interface EnqueueContinueParams {
	conversationId: string;
	runId: string;
	/** The user's HITL decision. For a plan review this carries the review
	 *  comments array (`{ type: "review", comments: string[] }`). */
	action: HitlPlanAction;
	query?: string;
	metadata?: HarnessJobMetadata;
}

/**
 * Bootstraps a conversation + run and enqueues a `start` job. Returns the ids so
 * the caller can subscribe to the harness event emitter by conversationId.
 * (Used by demo.ts now; API endpoints will call this later.)
 */
export async function enqueueHarnessStart(
	params: EnqueueStartParams,
): Promise<{ conversationId: string; runId: string }> {
	const conversationId = params.conversationId ?? generateID();
	const service = new HarnessService(conversationId);

	await service.ensureConversation({
		userId: params.metadata?.userId,
		projectId: params.metadata?.projectId,
		metadata: params.metadata,
	});
	const runId = await service.createRun({ userQuery: params.query });
	await new RedisService().setActiveRun(conversationId, runId);

	await harnessQueue.add(HARNESS_START_JOB, {
		type: "start",
		conversationId,
		runId,
		query: params.query,
		metadata: params.metadata,
	});

	return { conversationId, runId };
}

/** Enqueues a `continue` job to resume a parked (awaiting_hitl) run. */
export async function enqueueHarnessContinue(
	params: EnqueueContinueParams,
): Promise<{ conversationId: string; runId: string }> {
	await harnessQueue.add(HARNESS_CONTINUE_JOB, {
		type: "continue",
		conversationId: params.conversationId,
		runId: params.runId,
		query: params.query,
		action: params.action,
		metadata: params.metadata,
	});

	return { conversationId: params.conversationId, runId: params.runId };
}
