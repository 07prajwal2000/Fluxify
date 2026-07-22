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
	/** TTL for cached snapshots (seconds). Kept alive past completion so late
	 *  subscribers still receive the final state. */
	private static readonly SNAPSHOT_TTL = 3600;
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
				RedisService.SNAPSHOT_TTL,
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
				RedisService.SNAPSHOT_TTL,
			);
		} catch (e) {
			logger.error("[RedisService] Error appending event", {
				runId: event.runId,
				node: event.node,
				error: e,
			});
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
