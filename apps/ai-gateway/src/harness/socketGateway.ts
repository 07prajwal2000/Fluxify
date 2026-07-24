import { Server as SocketServer } from "socket.io";
import { Server as Engine } from "@socket.io/bun-engine";
import { logger } from "@fluxify/common";
import { and, eq, isNotNull } from "drizzle-orm";
import { auth, db, agentHarnessConversationsEntity } from "@fluxify/server";
import { RedisService } from "./internal/redisService";
import { subscribeConversations, ConversationMsgType } from "./notifications";
import type { HarnessSnapshot, HarnessStreamEvent } from "./streamTypes";

/* ============================================================================
 * SOCKET.IO GATEWAY
 * ----------------------------------------------------------------------------
 * socket.io runs on the Bun engine (@socket.io/bun-engine) and shares the same
 * Bun HTTP router as Hono — main.ts routes `/socket.io/*` to the engine and
 * everything else to `app.fetch` (socket.io has no Hono adapter, so both reuse
 * one Bun.serve).
 *
 * Each connection is authenticated against the better-auth session and joined to
 * a single per-user room `conversations:<userId>`. One room per user fans every
 * conversation run they may have triggered concurrently out to all their tabs;
 * `conversationId` in the message identifies which conversation, `stepId`
 * identifies the individual step update.
 *
 * On connect the client receives a `full_state` catch-up (the whole run state we
 * cache in Redis). Live `update` messages then stream in per node event. The
 * shape is intentionally coarse for now — to be refined once the UI is designed.
 * ========================================================================== */

/** Transport path. Prefixed with `/_/admin/ai` so the reverse proxy (which routes
 *  `/_/admin/*` to the backend, alongside `/_/admin/api/ai/v1` and `/_/admin/mcp`)
 *  forwards the socket.io handshake here. Clients must connect with this `path`.
 *  main.ts routes this prefix to the engine; keep the two in sync via this export. */
export const SOCKET_PATH = "/_/admin/ai/socket.io/";

/** The single socket.io event name; the `type` discriminant inside the payload
 *  tells the client whether it's a catch-up snapshot or a live update. */
export const HARNESS_SOCKET_EVENT = "conversation";

/** Per-user room. Colon-delimited (socket.io convention); independent of the
 *  dot-delimited NATS subject `conversations.<userId>`. */
export function conversationRoom(userId: string): string {
	return `conversations:${userId}`;
}

/**
 * Server -> client message, discriminated by `type`:
 *  - `full_state`: sent once on connect — current run state for every active
 *    conversation the user owns (read from Redis).
 *  - `update`: a single live harness event; `conversationId` + `stepId` identify it.
 */
export type HarnessSocketMessage =
	| { type: "full_state"; conversations: HarnessSnapshot[] }
	| {
			type: "update";
			conversationId: string;
			runId: string;
			stepId?: string;
			event: HarnessStreamEvent;
	  };

/** Events the server emits to clients (keyed by HARNESS_SOCKET_EVENT). */
interface ServerToClientEvents {
	conversation: (message: HarnessSocketMessage) => void;
}

interface HarnessSocketData {
	userId: string;
}

/** Pieces main.ts wires into its shared Bun.serve. */
export interface HarnessSocketHandler {
	fetch: (req: Request, server: unknown) => Response | Promise<Response>;
	websocket: ReturnType<Engine["handler"]>["websocket"];
}

const redisService = new RedisService();

/** Current cached run state for every conversation the user has active (one with
 *  a live `activeRunId`). Snapshots already evicted from Redis are skipped. */
async function activeSnapshotsForUser(userId: string): Promise<HarnessSnapshot[]> {
	const rows = await db
		.select({ activeRunId: agentHarnessConversationsEntity.activeRunId })
		.from(agentHarnessConversationsEntity)
		.where(
			and(
				eq(agentHarnessConversationsEntity.userId, userId),
				isNotNull(agentHarnessConversationsEntity.activeRunId),
			),
		);

	const snapshots = await Promise.all(
		rows.map((r) => redisService.getSnapshot(r.activeRunId!)),
	);
	return snapshots.filter((s): s is HarnessSnapshot => s !== null);
}

/**
 * Builds the socket.io server on the Bun engine, authenticates connections,
 * joins the per-user room, sends the Redis catch-up state, and streams live NATS
 * `conversations.*` events to rooms. Returns the fetch/websocket handlers for
 * main.ts to mount on the shared Bun.serve.
 */
export async function initializeHarnessSocket(): Promise<HarnessSocketHandler> {
	const engine = new Engine({ path: SOCKET_PATH });
	const io = new SocketServer<
		Record<string, never>,
		ServerToClientEvents,
		Record<string, never>,
		HarnessSocketData
	>({ cors: { origin: true, credentials: true } });
	// bun-engine's Server is duck-compatible with the engine.io Server socket.io
	// expects, but not nominally — bind through an unknown cast.
	io.bind(engine as unknown as Parameters<typeof io.bind>[0]);

	// Auth boundary: only a logged-in user may connect, and only to their own
	// room. Resolve the better-auth session from the handshake cookies.
	io.use(async (socket, next) => {
		try {
			const headers = new Headers(
				socket.handshake.headers as Record<string, string>,
			);
			const session = await auth.api.getSession({ headers });
			if (!session?.user?.id) return next(new Error("unauthorized"));
			socket.data.userId = session.user.id;
			next();
		} catch (error) {
			logger.error("[HarnessSocket] Auth failed", { error });
			next(new Error("unauthorized"));
		}
	});

	io.on("connection", async (socket) => {
		const userId = socket.data.userId;
		await socket.join(conversationRoom(userId));
		logger.info("[HarnessSocket] Client connected", {
			userId,
			socketId: socket.id,
		});

		// Catch-up: current run state for all the user's active conversations. Sent
		// only to the connecting socket so other tabs aren't re-flooded.
		try {
			const conversations = await activeSnapshotsForUser(userId);
			const message: HarnessSocketMessage = { type: "full_state", conversations };
			socket.emit(HARNESS_SOCKET_EVENT, message);
		} catch (error) {
			logger.error("[HarnessSocket] Failed to send full state", { userId, error });
		}
	});

	// Live fan-out: every NATS conversation event to its owner's room.
	await subscribeConversations((incoming) => {
		if (incoming.type !== ConversationMsgType.HARNESS_EVENT) return;
		const message: HarnessSocketMessage = {
			type: "update",
			conversationId: incoming.conversationId,
			runId: incoming.runId,
			stepId: incoming.event.stepId,
			event: incoming.event,
		};
		io.to(conversationRoom(incoming.userId)).emit(HARNESS_SOCKET_EVENT, message);
	});

	const handler = engine.handler();
	logger.info(`Initialized on ${SOCKET_PATH}`, "HarnessSocket");
	return {
		fetch: handler.fetch as HarnessSocketHandler["fetch"],
		websocket: handler.websocket,
	};
}
