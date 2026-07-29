import { db, agentHarnessConversationsEntity } from "@fluxify/server";
import { eq } from "drizzle-orm";

export async function setConversationFlags(
	conversationId: string,
	flags: { pinned?: boolean; archived?: boolean },
) {
	const [result] = await db
		.update(agentHarnessConversationsEntity)
		.set({ ...flags, updatedAt: new Date() })
		.where(eq(agentHarnessConversationsEntity.id, conversationId))
		.returning({
			id: agentHarnessConversationsEntity.id,
			pinned: agentHarnessConversationsEntity.pinned,
			archived: agentHarnessConversationsEntity.archived,
			updatedAt: agentHarnessConversationsEntity.updatedAt,
		});
	return result;
}
