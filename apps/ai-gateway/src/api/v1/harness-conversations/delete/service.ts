import { bumpListCacheVersion } from "../cacheVersion";
import { deleteConversation } from "./repository";

export default async function handleRequest(conversationId: string, userId: string) {
	await deleteConversation(conversationId);
	await bumpListCacheVersion(userId);
	return { success: true, message: "Conversation deleted successfully" };
}
