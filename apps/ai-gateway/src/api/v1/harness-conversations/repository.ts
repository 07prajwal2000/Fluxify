import { db, agentHarnessConversationsEntity } from "@fluxify/server";
import { eq } from "drizzle-orm";

export async function getConversationById(conversationId: string) {
	const result = await db
		.select()
		.from(agentHarnessConversationsEntity)
		.where(eq(agentHarnessConversationsEntity.id, conversationId))
		.limit(1);
	return result[0];
}
