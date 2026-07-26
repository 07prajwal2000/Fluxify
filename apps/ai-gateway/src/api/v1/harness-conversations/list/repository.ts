import {
	db,
	agentHarnessConversationsEntity,
	agentHarnessRunsEntity,
} from "@fluxify/server";
import { eq, desc, sql, inArray, and, ilike } from "drizzle-orm";

export interface ConversationListFilters {
	projectId: string;
	archived: boolean;
	pinned?: boolean;
	search?: string;
}

function listConditions(userId: string, filters: ConversationListFilters) {
	return and(
		eq(agentHarnessConversationsEntity.userId, userId),
		eq(agentHarnessConversationsEntity.projectId, filters.projectId),
		eq(agentHarnessConversationsEntity.archived, filters.archived),
		filters.pinned === undefined
			? undefined
			: eq(agentHarnessConversationsEntity.pinned, filters.pinned),
		filters.search === undefined
			? undefined
			: ilike(agentHarnessConversationsEntity.title, `%${filters.search}%`),
	);
}

export async function getConversationsByUserId(
	userId: string,
	limit: number,
	offset: number,
	filters: ConversationListFilters,
) {
	return db
		.select({
			id: agentHarnessConversationsEntity.id,
			title: agentHarnessConversationsEntity.title,
			status: agentHarnessConversationsEntity.status,
			pinned: agentHarnessConversationsEntity.pinned,
			archived: agentHarnessConversationsEntity.archived,
			createdAt: agentHarnessConversationsEntity.createdAt,
			updatedAt: agentHarnessConversationsEntity.updatedAt,
		})
		.from(agentHarnessConversationsEntity)
		.where(listConditions(userId, filters))
		// Pinned conversations always sort first.
		.orderBy(
			desc(agentHarnessConversationsEntity.pinned),
			desc(agentHarnessConversationsEntity.updatedAt),
		)
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

export async function countConversationsByUserId(
	userId: string,
	filters: ConversationListFilters,
) {
	const result = await db
		.select({ count: sql<number>`count(*)` })
		.from(agentHarnessConversationsEntity)
		.where(listConditions(userId, filters));
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
