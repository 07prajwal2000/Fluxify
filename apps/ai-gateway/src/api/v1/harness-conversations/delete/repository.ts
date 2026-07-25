import { db, agentHarnessConversationsEntity } from "@fluxify/server";
import { eq } from "drizzle-orm";

export async function deleteConversation(conversationId: string) {
	await db
		.delete(agentHarnessConversationsEntity)
		.where(eq(agentHarnessConversationsEntity.id, conversationId));
}
