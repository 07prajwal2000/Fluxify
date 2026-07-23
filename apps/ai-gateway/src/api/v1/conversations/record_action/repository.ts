import {
	db,
	aiChatHistoryEntity,
	aiChatConversationsEntity,
	aiWorkflowBuilderStepsEntity,
} from "@fluxify/server";
import { eq, sql, and } from "drizzle-orm";

export async function getChatMessageById(chatId: string) {
	const chatMessages = await db
		.select()
		.from(aiChatHistoryEntity)
		.where(eq(aiChatHistoryEntity.id, chatId));

	return chatMessages[0];
}

export async function updateChatMessagePlanStatus(
	chatId: string,
	conversationId: string,
	finalOutput: any,
	newHistoryItem: any,
	status: "plan_rejected" | "success" | "running",
) {
	// 1. Update chat history
	await db
		.update(aiChatHistoryEntity)
		.set({
			status,
			finalOutput,
			workflowExecutionHistory: sql`${aiChatHistoryEntity.workflowExecutionHistory} || ${JSON.stringify([newHistoryItem])}::jsonb`,
		})
		.where(eq(aiChatHistoryEntity.id, chatId));

	// 2. Update conversation status
	let conversationStatus: "running" | "success" | "plan_rejected" | "paused" = "running";
	if (status === "plan_rejected") {
		conversationStatus = "plan_rejected";
	} else if (newHistoryItem.input.action === "approve") {
		conversationStatus = "success";
	} else {
		// action === "review" (modify)
		conversationStatus = "running";
	}

	await db
		.update(aiChatConversationsEntity)
		.set({ status: conversationStatus })
		.where(eq(aiChatConversationsEntity.id, conversationId));

	// 3. Update builder step status
	let stepStatus: "completed" | "failed" | "paused" | "awaiting_review" | "running" = "completed";
	if (status === "plan_rejected") {
		stepStatus = "failed";
	}

	await db
		.update(aiWorkflowBuilderStepsEntity)
		.set({ stepStatus, updatedAt: new Date() })
		.where(
			and(
				eq(aiWorkflowBuilderStepsEntity.chatHistoryId, chatId),
				eq(aiWorkflowBuilderStepsEntity.stepStatus, "awaiting_review"),
			),
		);
}
