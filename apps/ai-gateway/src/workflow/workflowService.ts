import type { Job } from "bullmq";
import type {
	AIWorkflowGatewayData,
	ConversationWorkflowStatus,
} from "./queue";
import {
	aiChatHistoryEntity,
	aiChatConversationsEntity,
	aiWorkflowBuilderStepsEntity,
	db,
	deleteCacheKey,
	setCache,
	deleteCacheKeysByPattern,
} from "@fluxify/server";
import { eq } from "drizzle-orm";

/**
 * Generates the Redis cache key for a conversation's workflow status.
 */
export function getConversationKey(conversationId: string): string {
	return `workflow:${conversationId}`;
}

/**
 * Fetches a conversation record by ID. Returns undefined if not found.
 */
export async function fetchConversation(conversationId: string) {
	return db
		.select()
		.from(aiChatConversationsEntity)
		.where(eq(aiChatConversationsEntity.id, conversationId))
		.then((res: any) => res[0]);
}

/**
 * Fetches the last builder step for a conversation.
 */
export async function fetchLastBuilderStep(conversationId: string) {
	return db
		.select()
		.from(aiWorkflowBuilderStepsEntity)
		.where(eq(aiWorkflowBuilderStepsEntity.conversationId, conversationId))
		.then((res: any) => res[res.length - 1]);
}

/**
 * Pushes conversation workflow status to both the BullMQ job progress and Redis cache.
 * When `deleteCache` is true, removes the key instead of setting it.
 */
export async function trackConversationStatus(
	conversationId: string,
	status: ConversationWorkflowStatus,
	job: Job<AIWorkflowGatewayData>,
	deleteCache?: boolean,
) {
	const key = getConversationKey(conversationId);

	await job.updateProgress(status);
	if (deleteCache === true) await deleteCacheKey(key);
	else await setCache(key, JSON.stringify({ status }));
}

/**
 * Persists the final conversation status to the DB (chat history + builder steps).
 */
export async function saveConversationStatus(
	status: ConversationWorkflowStatus,
) {
	let chatHistoryId = status.chatHistoryId;
	const historyData = {
		conversationId: status.conversationId,
		userQuery: status.userQuery,
		status: status.status === "under_plan_review" ? "paused" : status.status === "error" ? "error" : "success",
		finalOutput: {
			nodeId: status.currentNodeId,
			result: status.finalResult,
		},
		workflowExecutionHistory: status.executionHistory.map((history) => ({
			type: history.type,
			id: history.name,
			status: history.status,
		})),
	};

	if (chatHistoryId) {
		await db
			.update(aiChatHistoryEntity)
			.set(historyData as any)
			.where(eq(aiChatHistoryEntity.id, chatHistoryId));
	} else {
		const historyInsert = await db
			.insert(aiChatHistoryEntity)
			.values(historyData as any)
			.returning({ id: aiChatHistoryEntity.id });

		chatHistoryId = historyInsert[0]?.id;
	}

	if (status.status === "under_plan_review" && chatHistoryId) {
		const stepData = status.finalResult?.builderStepData;
		if (stepData) {
			if (status.chatHistoryId) {
				await db
					.update(aiWorkflowBuilderStepsEntity)
					.set({
						inputData: stepData.builderState,
						outputData: stepData.plannerOutput,
						stepStatus: "awaiting_review",
						updatedAt: new Date(),
					})
					.where(eq(aiWorkflowBuilderStepsEntity.chatHistoryId, chatHistoryId));
			} else {
				await db.insert(aiWorkflowBuilderStepsEntity).values({
					chatHistoryId,
					conversationId: status.conversationId,
					stepType: "planner",
					stepStatus: "awaiting_review",
					inputData: stepData.builderState,
					outputData: stepData.plannerOutput,
					metadata: {
						nodeId: "planner",
						stepSource: "planner",
						tokenUsage: stepData.tokenUsage,
					},
				});
			}
		}
	}
}

/**
 * Invalidates all conversation-related caches.
 */
export async function invalidateConversationCaches(
	conversationId: string,
	projectId: string,
) {
	await deleteCacheKeysByPattern(
		`conversations:list_messages:${conversationId}:*`,
	);
	await deleteCacheKeysByPattern(`conversations:list:${projectId}:*`);
}
