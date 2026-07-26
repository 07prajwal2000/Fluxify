import { ForbiddenError, ConflictError, NotFoundError } from "@fluxify/server";
import { enqueueHarnessStart } from "../../../../harness/internal/enqueue";
import { getConversationById, getProjectIntegration } from "../repository";
import { isConversationLocked } from "../status";
import { bumpListCacheVersion } from "../cacheVersion";
import type { SendMessageBody } from "./dto";

/**
 * Verifies the picked AI integration exists in this project and is harness-eligible
 * (`config.useForHarness === true`). Throws otherwise.
 */
async function assertHarnessIntegration(integrationId: string, projectId: string) {
	const integration = await getProjectIntegration(integrationId, projectId);

	if (!integration || integration.group !== "ai") {
		throw new NotFoundError("AI integration not found for this project");
	}
	if ((integration.config as { useForHarness?: boolean })?.useForHarness !== true) {
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
