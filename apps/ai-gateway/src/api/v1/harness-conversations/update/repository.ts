import { db, agentHarnessConversationsEntity } from "@fluxify/server";
import { eq } from "drizzle-orm";

export async function updateConversationTitle(
	conversationId: string,
	title: string,
) {
	const [result] = await db
		.update(agentHarnessConversationsEntity)
		.set({ title, updatedAt: new Date() })
		.where(eq(agentHarnessConversationsEntity.id, conversationId))
		.returning({
			id: agentHarnessConversationsEntity.id,
			title: agentHarnessConversationsEntity.title,
			updatedAt: agentHarnessConversationsEntity.updatedAt,
		});
	return result;
}
