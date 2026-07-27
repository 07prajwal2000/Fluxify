import {
	db,
	agentHarnessRunsEntity,
	agentHarnessArtifactsEntity,
} from "@fluxify/server";
import { and, desc, eq, sql } from "drizzle-orm";
import type { MessageCursor } from "./cursor";

/**
 * One "message" is one run (user query + AI response). Keyset pagination on
 * `(created_at, id)` — no OFFSET, so page N costs the same as page 1 no matter
 * how long the history gets. The row-wise `<` lets Postgres seek straight to
 * the cursor on the conversation index instead of scanning past skipped rows.
 *
 * Artifacts are a grouping row (at most one per run), so the left join can't
 * multiply rows and break the limit.
 */
export async function getMessagesPage(
	conversationId: string,
	limit: number,
	cursor?: MessageCursor,
) {
	return db
		.select({
			id: agentHarnessRunsEntity.id,
			userQuery: agentHarnessRunsEntity.userQuery,
			aiResponse: agentHarnessRunsEntity.aiResponse,
			status: agentHarnessRunsEntity.status,
			createdAt: agentHarnessRunsEntity.createdAt,
			completedAt: agentHarnessRunsEntity.completedAt,
			artifactId: agentHarnessArtifactsEntity.id,
		})
		.from(agentHarnessRunsEntity)
		.leftJoin(
			agentHarnessArtifactsEntity,
			eq(agentHarnessArtifactsEntity.runId, agentHarnessRunsEntity.id),
		)
		.where(
			and(
				eq(agentHarnessRunsEntity.conversationId, conversationId),
				cursor
					? sql`(${agentHarnessRunsEntity.createdAt}, ${agentHarnessRunsEntity.id}) < (${cursor.createdAt}, ${cursor.id})`
					: undefined,
			),
		)
		.orderBy(desc(agentHarnessRunsEntity.createdAt), desc(agentHarnessRunsEntity.id))
		.limit(limit);
}
