import { type MiddlewareHandler } from "hono";
import { ForbiddenError, NotFoundError, type User } from "@fluxify/server";
import { getConversationById } from "./repository";

export const verifyHarnessConversationOwner: MiddlewareHandler = async (c, next) => {
	const user = c.get("user") as User & { isSystemAdmin: boolean };
	const conversationId = c.req.param("conversationId");
	if (!conversationId) {
		throw new NotFoundError("Conversation ID is required");
	}

	const conversation = await getConversationById(conversationId);
	if (!conversation) {
		throw new NotFoundError("Conversation not found");
	}

	if (conversation.userId !== user.id && !user.isSystemAdmin) {
		throw new ForbiddenError("You do not own this conversation");
	}

	c.set("conversation", conversation);
	await next();
};
