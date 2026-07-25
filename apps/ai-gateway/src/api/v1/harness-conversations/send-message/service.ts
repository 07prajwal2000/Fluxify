import { ForbiddenError, ConflictError, NotFoundError } from "@fluxify/server";
import { enqueueHarnessStart } from "../../../../harness/internal/enqueue";
import { getConversationById } from "../repository";
import { isConversationLocked } from "../status";
import { bumpListCacheVersion } from "../cacheVersion";
import type { SendMessageBody } from "./dto";

export default async function handleRequest(
	userId: string,
	body: SendMessageBody,
	isSystemAdmin: boolean,
) {
	if (body.conversationId) {
		const conversation = await getConversationById(body.conversationId);
		if (!conversation) {
			throw new NotFoundError("Conversation not found");
		}
		if (conversation.userId !== userId && !isSystemAdmin) {
			throw new ForbiddenError("You do not own this conversation");
		}
		if (isConversationLocked(conversation.status)) {
			throw new ConflictError(
				"This conversation already has a run in progress",
			);
		}
	}

	const { conversationId, runId } = await enqueueHarnessStart({
		conversationId: body.conversationId,
		query: body.query,
		metadata: { userId, location: body.location },
	});

	await bumpListCacheVersion(userId);

	return { conversationId, runId };
}
