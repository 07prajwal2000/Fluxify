import { ConflictError } from "@fluxify/server";
import { setConversationFlags } from "./repository";
import { bumpListCacheVersion } from "../cacheVersion";
import type { ConversationAction } from "./dto";

/** Archiving always clears pinned (an archived conversation can't be pinned);
 *  pinning an already-archived conversation is rejected instead of silently
 *  un-archiving it. */
function resolveFlags(
	action: ConversationAction,
	currentlyArchived: boolean,
): { pinned?: boolean; archived?: boolean } {
	switch (action) {
		case "pin":
			if (currentlyArchived) {
				throw new ConflictError("Cannot pin an archived conversation");
			}
			return { pinned: true };
		case "unpin":
			return { pinned: false };
		case "archive":
			return { archived: true, pinned: false };
		case "unarchive":
			return { archived: false };
	}
}

export default async function handleRequest(
	conversationId: string,
	action: ConversationAction,
	conversation: { userId: string | null; archived: boolean },
) {
	const flags = resolveFlags(action, conversation.archived);
	const result = await setConversationFlags(conversationId, flags);

	if (conversation.userId) {
		await bumpListCacheVersion(conversation.userId);
	}

	return result;
}
