import type { AgentRow } from "@/services/agentConversations";

/**
 * Idle time after which a chat's prompt cache has almost certainly expired: provider
 * caches last minutes (Anthropic 5 min by default, 1 h opt-in), so 20 min is a safe guess.
 */
// ponytail: one estimate for every provider; per-provider TTLs if hints prove misleading
export const CACHE_COLD_AFTER_MS = 20 * 60_000;

/** When the last model call finished: the newest saved row, or null when no row is dated. */
export function lastModelCallAt(rows: Pick<AgentRow, "createdAt">[]): number | null {
	let last: number | null = null;
	for (const row of rows) {
		const at = Date.parse(row.createdAt ?? "");
		if (!Number.isNaN(at) && (last === null || at > last)) last = at;
	}
	return last;
}

/** The next message would re-read the history uncached. Never while a run is going. */
export function isCacheCold(lastCallAt: number | null, now: number, running: boolean): boolean {
	if (running || lastCallAt === null) return false;
	return now - lastCallAt >= CACHE_COLD_AFTER_MS;
}
