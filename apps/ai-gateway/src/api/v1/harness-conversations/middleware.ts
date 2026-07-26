import { type MiddlewareHandler } from "hono";
import {
	BadRequestError,
	ForbiddenError,
	NotFoundError,
	hasProjectAccess,
	type AccessControlRole,
	type AuthACL,
	type User,
} from "@fluxify/server";
import { getConversationById } from "./repository";

/** Every route in this feature is mounted under `/:projectId/harness-conversations`
 *  — this verifies the caller actually has access to that project before anything
 *  else runs. */
export function verifyProjectAccess(requiredRole: AccessControlRole): MiddlewareHandler {
	return async (c, next) => {
		const user = c.get("user") as User & { isSystemAdmin: boolean };
		const acl = c.get("acl") as AuthACL[];
		const projectId = c.req.param("projectId");

		if (!projectId) {
			throw new BadRequestError("projectId is required");
		}
		if (!hasProjectAccess(user, acl, projectId, requiredRole)) {
			throw new ForbiddenError("You do not have access to this project");
		}

		await next();
	};
}

export const verifyHarnessConversationOwner: MiddlewareHandler = async (c, next) => {
	const user = c.get("user") as User & { isSystemAdmin: boolean };
	const conversationId = c.req.param("conversationId");
	const projectId = c.req.param("projectId");
	if (!conversationId) {
		throw new NotFoundError("Conversation ID is required");
	}

	const conversation = await getConversationById(conversationId);
	if (!conversation || conversation.projectId !== projectId) {
		// Same 404 either way — don't leak that a conversation exists in a
		// different project the caller was scoped out of.
		throw new NotFoundError("Conversation not found");
	}

	if (conversation.userId !== user.id && !user.isSystemAdmin) {
		throw new ForbiddenError("You do not own this conversation");
	}

	c.set("conversation", conversation);
	await next();
};
