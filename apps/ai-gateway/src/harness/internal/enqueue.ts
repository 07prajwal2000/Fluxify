import { generateID } from "@fluxify/lib";
import { ConflictError } from "@fluxify/server";
import { HarnessService, type HitlPlanAction } from "./harnessService";
import { RedisService } from "./redisService";
import {
	harnessContinueSubject,
	harnessStartSubject,
	publishHarnessJob,
	type HarnessJobData,
	type HarnessJobMetadata,
} from "../queue";

export interface EnqueueStartParams {
	/** Reuse an existing conversation, or omit to create a fresh one. */
	conversationId?: string;
	query: string;
	/** AI integration chosen for this run; persisted on the run row. */
	integrationId?: string;
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
 * `Nats-Msg-Id` for one publish. Unique per *intent*, so the stream's dedupe
 * window swallows a republish of the same message (an ambiguous publish that the
 * caller retried) without ever swallowing a second, legitimate HITL decision on
 * the same run.
 */
function idempotencyKey(type: HarnessJobData["type"], runId: string): string {
	return `${type}:${runId}:${generateID()}`;
}

/**
 * Bootstraps a conversation + run and queues a `start` job. Returns the ids so
 * the caller can subscribe to the run's events by conversationId.
 *
 * Throws `ConflictError` when the conversation already has a live run — the
 * claim inside `createRun` is atomic, unlike the status check the API does
 * first, so this is the one that survives two requests arriving together.
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
	const runId = await service.createRun({
		userQuery: params.query,
		integrationId: params.integrationId,
	});
	if (!runId) {
		throw new ConflictError("This conversation already has a run in progress");
	}
	await new RedisService().setActiveRun(conversationId, runId);

	const key = idempotencyKey("start", runId);
	await publishHarnessJob(
		harnessStartSubject(conversationId),
		{
			type: "start",
			conversationId,
			runId,
			query: params.query,
			metadata: params.metadata,
			idempotencyKey: key,
		},
		{ msgId: key },
	);

	return { conversationId, runId };
}

/** Queues a `continue` job to resume a parked (awaiting_hitl) run. Throws
 *  `ConflictError` when the run is no longer parked or has moved on. */
export async function enqueueHarnessContinue(
	params: EnqueueContinueParams,
): Promise<{ conversationId: string; runId: string }> {
	const service = new HarnessService(params.conversationId);
	const claimed = await service.claimConversationForContinue(params.runId);
	if (!claimed) {
		throw new ConflictError("Conversation is not awaiting review");
	}

	const key = idempotencyKey("continue", params.runId);
	await publishHarnessJob(
		harnessContinueSubject(params.conversationId),
		{
			type: "continue",
			conversationId: params.conversationId,
			runId: params.runId,
			query: params.query,
			action: params.action,
			metadata: params.metadata,
			idempotencyKey: key,
		},
		{ msgId: key },
	);

	return { conversationId: params.conversationId, runId: params.runId };
}
