import {
	BadRequestError,
	NotFoundError,
	deleteCacheKey,
} from "@fluxify/server";
import {
	workflowQueue,
	CONTINUE_WORKFLOW_JOB_NAME,
} from "../../../../workflow/queue";
import { getChatMessageById, updateChatMessagePlanStatus } from "./repository";

export async function recordActionService(
	conversationId: string,
	chatId: string,
	action: "approve" | "reject" | "review",
	reviews?: string[],
	rejectReason?: string,
) {
	// Fetch message history
	const chatMessage = await getChatMessageById(chatId);

	if (!chatMessage || chatMessage.conversationId !== conversationId) {
		throw new NotFoundError("Chat message not found");
	}

	if (chatMessage.status !== "paused") {
		throw new BadRequestError(
			"Action not allowed: chat is not awaiting plan review.",
		);
	}

	const newHistoryItem = {
		type: "node",
		id: "plan_review",
		name: "Plan Review",
		status: "success",
		input: { action },
		output:
			action === "approve"
				? "Plan approved"
				: action === "reject"
					? "Plan rejected"
					: "Review Plan sent",
	};

	if (action === "reject") {
		// Update status to plan_rejected
		const finalOutput = chatMessage.finalOutput || {
			nodeId: "planner",
			result: {},
		};
		if (finalOutput.result) {
			(finalOutput.result as any).rejected = true;
			(finalOutput.result as any).rejectReason = rejectReason;
		}

		await updateChatMessagePlanStatus(
			chatId,
			conversationId,
			finalOutput,
			newHistoryItem,
			"plan_rejected",
		);

		await deleteCacheKey(`workflow:${conversationId}`);

		return { success: true };
	}

	// For approve or review, update DB and enqueue job
	const finalOutput = chatMessage.finalOutput || {
		nodeId: "planner",
		result: {},
	};
	if (finalOutput.result) {
		(finalOutput.result as any).approved = action === "approve";
		(finalOutput.result as any).reviewed = action === "review";
	}

	await updateChatMessagePlanStatus(
		chatId,
		conversationId,
		finalOutput,
		newHistoryItem,
		"running",
	);

	await enqueueWorkflowAction(
		conversationId,
		chatMessage.userQuery,
		action,
		chatId,
		reviews,
	);

	return { success: true };
}

async function enqueueWorkflowAction(
	conversationId: string,
	userQuery: string,
	action: "approve" | "review",
	chatHistoryId: string,
	reviews?: string[],
) {
	await workflowQueue.add(
		CONTINUE_WORKFLOW_JOB_NAME,
		{
			type: "plan_review",
			data: {
				conversationId,
				userQuery,
				reviewAction: action === "review" ? "modify" : action,
				reviewComments: reviews ? JSON.stringify(reviews) : "",
				chatHistoryId,
			},
		},
		{
			jobId: `workflow-resume-${conversationId}-${Date.now()}`,
		},
	);
}
