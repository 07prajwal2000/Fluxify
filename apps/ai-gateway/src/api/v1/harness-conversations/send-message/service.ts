import {
	ForbiddenError,
	ConflictError,
	NotFoundError,
	getProjectSetting,
} from "@fluxify/server";
import { enqueueHarnessStart } from "../../../../harness/internal/enqueue";
import { getConversationById, getProjectIntegration } from "../repository";
import { isConversationLocked } from "../status";
import { bumpListCacheVersion } from "../cacheVersion";
import { assertRunQuota } from "./rateLimit";
import type { SendMessageBody } from "./dto";

/**
 * Verifies the picked AI integration exists in this project and is harness-eligible:
 * either `config.useForHarness === true`, or it is the project's configured agent
 * connection (`settings.ai.agentConnectionId`) — that selection is itself the opt-in,
 * and there is no UI yet to flip `useForHarness`. Throws otherwise.
 */
async function assertHarnessIntegration(integrationId: string, projectId: string) {
	const integration = await getProjectIntegration(integrationId, projectId);

	if (!integration || integration.group !== "ai") {
		throw new NotFoundError("AI integration not found for this project");
	}
	if ((integration.config as { useForHarness?: boolean })?.useForHarness === true) {
		return;
	}

	const agentConnectionId = await getProjectSetting(
		projectId,
		"settings.ai.agentConnectionId",
	);
	if (agentConnectionId !== integrationId) {
		throw new ForbiddenError(
			"This integration is not enabled for the agent usage",
		);
	}
}

export default async function handleRequest(
	userId: string,
	projectId: string,
	body: SendMessageBody,
	isSystemAdmin: boolean,
) {
	// Before any of the checks below: they are all about *this* request being
	// well-formed, and the quota is about how many the user has already sent.
	await assertRunQuota(userId);

	if (body.conversationId) {
		const conversation = await getConversationById(body.conversationId);
		if (!conversation || conversation.projectId !== projectId) {
			throw new NotFoundError("Conversation not found");
		}
		if (conversation.userId !== userId && !isSystemAdmin) {
			throw new ForbiddenError("You do not own this conversation");
		}
		if (conversation.archived) {
			throw new ConflictError("Cannot send a message to an archived conversation");
		}
		if (isConversationLocked(conversation.status)) {
			throw new ConflictError(
				"This conversation already has a run in progress",
			);
		}
	}

	if (body.integrationId) {
		await assertHarnessIntegration(body.integrationId, projectId);
	}

	const { conversationId, runId } = await enqueueHarnessStart({
		conversationId: body.conversationId,
		query: body.query,
		integrationId: body.integrationId,
		metadata: {
			userId,
			projectId,
			location: body.location,
			integrationId: body.integrationId,
		},
	});

	await bumpListCacheVersion(userId);

	return { conversationId, runId };
}
