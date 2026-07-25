import { updateConversationTitle } from "./repository";
import { bumpListCacheVersion } from "../cacheVersion";

export default async function handleRequest(
	conversationId: string,
	title: string,
	userId: string,
) {
	const result = await updateConversationTitle(conversationId, title);
	await bumpListCacheVersion(userId);
	return result;
}
