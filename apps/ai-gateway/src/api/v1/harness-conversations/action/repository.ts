import {
	db,
	agentHarnessConversationsEntity,
	agentHarnessSubArtifactsEntity,
} from "@fluxify/server";
import { and, eq } from "drizzle-orm";

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

/** Marks one sub-artifact as applied to the project. Scoped to the conversation
 *  so a client can't flip another chat's artifact. Idempotent — resending just
 *  refreshes the timestamp. Returns undefined when the id isn't in this chat. */
export async function markSubArtifactApplied(
	conversationId: string,
	subArtifactId: string,
) {
	const [result] = await db
		.update(agentHarnessSubArtifactsEntity)
		.set({ appliedAt: new Date() })
		.where(
			and(
				eq(agentHarnessSubArtifactsEntity.id, subArtifactId),
				eq(agentHarnessSubArtifactsEntity.conversationId, conversationId),
			),
		)
		.returning({
			id: agentHarnessSubArtifactsEntity.id,
			appliedAt: agentHarnessSubArtifactsEntity.appliedAt,
		});
	return result;
}
