import { logger } from "@fluxify/common";
import { and, eq, inArray, lt, notInArray } from "drizzle-orm";
import { db } from "../../db";
import { agentConversationsEntity } from "../../db/agent-schema";

/**
 * Deletes archived agent conversations a week after they were archived (#721).
 * Runs and messages go with the conversation through `onDelete: cascade`. Admin
 * only: this is the process that owns the database connection.
 *
 * Idempotent and batched, so a missed tick is covered by the next one and one
 * tick never holds a long lock (the #619 rule). A conversation with a run in
 * progress is skipped and picked up on a later tick, so the delete never races
 * a live run.
 */

/** How long an archived conversation is kept. A constant, not an env var (#721). */
export const AGENT_CONVERSATION_MAX_AGE_DAYS = 7;
/** conversations per delete; each takes its runs and messages with it */
const RETENTION_BATCH = 100;
/** statuses where a run still holds the conversation */
const LIVE_STATUSES = ["running", "paused_hitl"] as const;

export async function deleteExpiredAgentConversations(
	maxAgeDays = AGENT_CONVERSATION_MAX_AGE_DAYS,
) {
	const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60_000);
	let deleted = 0;
	for (;;) {
		const batch = db
			.select({ id: agentConversationsEntity.id })
			.from(agentConversationsEntity)
			.where(
				and(
					eq(agentConversationsEntity.archived, true),
					lt(agentConversationsEntity.archivedAt, cutoff),
					notInArray(agentConversationsEntity.status, [...LIVE_STATUSES]),
				),
			)
			.limit(RETENTION_BATCH);
		const rows = await db
			.delete(agentConversationsEntity)
			.where(inArray(agentConversationsEntity.id, batch))
			.returning({ id: agentConversationsEntity.id });
		deleted += rows.length;
		if (rows.length < RETENTION_BATCH) break;
	}
	if (deleted) {
		logger.info(
			`[agents] deleted ${deleted} archived conversation(s) older than ${maxAgeDays} days`,
			"AGENTS",
		);
	}
	return deleted;
}
