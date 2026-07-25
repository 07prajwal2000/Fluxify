import {
	db,
	agentHarnessConversationsEntity,
	agentHarnessRunsEntity,
} from "@fluxify/server";
import { eq, desc, sql, inArray } from "drizzle-orm";

export async function getConversationsByUserId(
	userId: string,
	limit: number,
	offset: number,
) {
	return db
		.select({
			id: agentHarnessConversationsEntity.id,
			title: agentHarnessConversationsEntity.title,
			status: agentHarnessConversationsEntity.status,
			createdAt: agentHarnessConversationsEntity.createdAt,
			updatedAt: agentHarnessConversationsEntity.updatedAt,
		})
		.from(agentHarnessConversationsEntity)
		.where(eq(agentHarnessConversationsEntity.userId, userId))
		.orderBy(desc(agentHarnessConversationsEntity.updatedAt))
		.limit(limit)
		.offset(offset);
}

/** Live status column, keyed by conversationId — bypasses the list cache so a
 *  just-finished run's terminal status is never masked by a stale cache entry. */
export async function getStatusesByIds(
	conversationIds: string[],
): Promise<Map<string, string>> {
	if (conversationIds.length === 0) return new Map();

	const rows = await db
		.select({
			id: agentHarnessConversationsEntity.id,
			status: agentHarnessConversationsEntity.status,
		})
		.from(agentHarnessConversationsEntity)
		.where(inArray(agentHarnessConversationsEntity.id, conversationIds));

	return new Map(rows.map((r) => [r.id, r.status]));
}

export async function countConversationsByUserId(userId: string) {
	const result = await db
		.select({ count: sql<number>`count(*)` })
		.from(agentHarnessConversationsEntity)
		.where(eq(agentHarnessConversationsEntity.userId, userId));
	return Number(result[0]?.count ?? 0);
}

/** Latest user query per conversation, keyed by conversationId. */
export async function getLatestUserQueries(
	conversationIds: string[],
): Promise<Map<string, string>> {
	if (conversationIds.length === 0) return new Map();

	const rows = await db
		.selectDistinctOn([agentHarnessRunsEntity.conversationId], {
			conversationId: agentHarnessRunsEntity.conversationId,
			userQuery: agentHarnessRunsEntity.userQuery,
		})
		.from(agentHarnessRunsEntity)
		.where(inArray(agentHarnessRunsEntity.conversationId, conversationIds))
		.orderBy(
			agentHarnessRunsEntity.conversationId,
			desc(agentHarnessRunsEntity.createdAt),
		);

	return new Map(rows.map((r) => [r.conversationId, r.userQuery]));
}
