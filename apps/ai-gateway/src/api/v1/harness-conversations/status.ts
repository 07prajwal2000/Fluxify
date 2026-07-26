import { RedisService } from "../../../harness/internal/redisService";

const redisService = new RedisService();

/** Conversation-level statuses that mean "a run is in flight". */
const LOCKED_STATUSES = new Set(["running", "paused_hitl"]);

export function isConversationLocked(status: string): boolean {
	return LOCKED_STATUSES.has(status);
}

/**
 * Resolves the status to show the user for a whole page of conversations in
 * at most 2 Redis round trips total (not 2 per row), keyed by conversationId.
 *
 * While a run is in flight the DB row is stale (only flushed on terminal
 * events), so the granular run status (queued / routing / verifying / ...) is
 * read from the Redis snapshot instead — see `harness/callbacks.ts` +
 * `harness/internal/redisService.ts` for how it's written. Conversations that
 * aren't locked skip Redis entirely and keep their DB status.
 */
export async function resolveRealtimeStatuses(
	conversations: Array<{ id: string; status: string }>,
): Promise<Map<string, string>> {
	const result = new Map(conversations.map((c) => [c.id, c.status]));

	const locked = conversations.filter((c) => isConversationLocked(c.status));
	if (locked.length === 0) return result;

	const activeRuns = await redisService.getActiveRuns(locked.map((c) => c.id));
	if (activeRuns.size === 0) return result;

	const snapshots = await redisService.getSnapshots([...activeRuns.values()]);

	for (const conversation of locked) {
		const runId = activeRuns.get(conversation.id);
		const runStatus = runId ? snapshots.get(runId)?.runStatus : undefined;
		if (runStatus) result.set(conversation.id, runStatus);
	}

	return result;
}
