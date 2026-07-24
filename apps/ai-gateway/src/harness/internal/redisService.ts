import { getCache, setCacheEx, deleteCacheKey } from "@fluxify/server";
import { logger } from "@fluxify/common";
import type {
	HarnessStreamEvent,
	HarnessSnapshot,
} from "../streamTypes";

/**
 * Redis-backed cache for harness live state. Stores a per-run snapshot (run
 * status + bounded event log) so a late SSE subscriber can catch up before live
 * events stream in, plus a conversation -> active run pointer.
 *
 * The worker is the single writer per run, so read-modify-write on the snapshot
 * is race-free. Uses the shared `@fluxify/server` cache helpers (ioredis).
 */
export class RedisService {
	/** TTL while a run is live (seconds). Long enough to never evict mid-run; acts
	 *  only as a safety net if a worker dies without finalizing (see finalizeSnapshot).
	 *  ponytail: fixed 6h ceiling — only leaks on a hard worker crash, self-heals. */
	private static readonly RUNNING_TTL = 6 * 3600;
	/** TTL applied once a run finishes (any terminal state) so the key auto-evicts
	 *  shortly after, giving late subscribers a brief window to read the final state. */
	private static readonly FINALIZE_TTL = 60;
	/** Max events retained in a snapshot to bound cache size. */
	private static readonly MAX_EVENTS = 200;

	private snapshotKey(runId: string): string {
		return `harness:run:${runId}:snapshot`;
	}

	private activeRunKey(conversationId: string): string {
		return `harness:conv:${conversationId}:activeRun`;
	}

	async setActiveRun(conversationId: string, runId: string): Promise<void> {
		try {
			await setCacheEx(
				this.activeRunKey(conversationId),
				runId,
				RedisService.RUNNING_TTL,
			);
		} catch (e) {
			logger.error("[RedisService] Error setting active run", { conversationId, error: e });
		}
	}

	async getActiveRun(conversationId: string): Promise<string | null> {
		try {
			const runId = await getCache(this.activeRunKey(conversationId));
			return runId || null;
		} catch (e) {
			logger.error("[RedisService] Error reading active run", { conversationId, error: e });
			return null;
		}
	}

	async getSnapshot(runId: string): Promise<HarnessSnapshot | null> {
		try {
			const raw = await getCache(this.snapshotKey(runId));
			return raw ? (JSON.parse(raw) as HarnessSnapshot) : null;
		} catch (e) {
			logger.error("[RedisService] Error reading snapshot", { runId, error: e });
			return null;
		}
	}

	/**
	 * Appends an event to the run snapshot, updating run status / current node.
	 * Creates the snapshot on first event.
	 */
	async appendEvent(event: HarnessStreamEvent): Promise<void> {
		try {
			const existing = await this.getSnapshot(event.runId);
			const events = existing?.events ?? [];
			events.push(event);
			if (events.length > RedisService.MAX_EVENTS) {
				events.splice(0, events.length - RedisService.MAX_EVENTS);
			}

			const snapshot: HarnessSnapshot = {
				conversationId: event.conversationId,
				runId: event.runId,
				runStatus: event.runStatus,
				currentNode: event.node,
				currentLevel: event.level,
				events,
				updatedAt: Date.now(),
			};

			await setCacheEx(
				this.snapshotKey(event.runId),
				JSON.stringify(snapshot),
				RedisService.RUNNING_TTL,
			);
		} catch (e) {
			logger.error("[RedisService] Error appending event", {
				runId: event.runId,
				node: event.node,
				error: e,
			});
		}
	}

	/**
	 * Marks a run's snapshot as finished by shortening its TTL to FINALIZE_TTL, so
	 * the whole-run-state key auto-evicts a minute after completion (success,
	 * failure, or HITL) instead of being deleted instantly. No-op if the snapshot
	 * has already expired.
	 */
	async finalizeSnapshot(runId: string): Promise<void> {
		try {
			const snapshot = await this.getSnapshot(runId);
			if (!snapshot) return;
			await setCacheEx(
				this.snapshotKey(runId),
				JSON.stringify(snapshot),
				RedisService.FINALIZE_TTL,
			);
		} catch (e) {
			logger.error("[RedisService] Error finalizing snapshot", { runId, error: e });
		}
	}

	/** Clears the active-run pointer (snapshot is left to expire via TTL). */
	async clearActiveRun(conversationId: string): Promise<void> {
		try {
			await deleteCacheKey(this.activeRunKey(conversationId));
		} catch (e) {
			logger.error("[RedisService] Error clearing active run", { conversationId, error: e });
		}
	}
}
