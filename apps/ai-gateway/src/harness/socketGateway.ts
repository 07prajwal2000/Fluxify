import { Server as SocketServer } from "socket.io";
import { Server as Engine } from "@socket.io/bun-engine";
import { logger } from "@fluxify/common";
import { and, eq, isNotNull } from "drizzle-orm";
import {
	auth,
	db,
	agentHarnessConversationsEntity,
	agentHarnessRunsEntity,
} from "@fluxify/server";
import { RedisService } from "./internal/redisService";
import { subscribeConversations, ConversationMsgType } from "./notifications";
import type { HarnessRunStatus, HarnessSnapshot } from "./streamTypes";
import {
	SOCKET_PATH,
	HARNESS_SOCKET_EVENT,
	type HarnessSocketMessage,
} from "./clientContract";

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
 * `conversationId` in the message identifies which conversation, `nodeId` inside
 * the event identifies the individual node instance being updated.
 *
 * On connect the client receives a `full_state` catch-up (every event of every
 * in-flight run, replayed from the Redis queue). Live `update` messages then
 * stream in. Both carry the identical `HarnessStreamEvent` shape — see
 * `harness_events.md`.
 * ========================================================================== */

/** The wire contract (path, event name, message union) lives in `clientContract.ts`
 *  — a runtime-import-free module the browser client imports too. Re-exported here
 *  so existing server-side importers (main.ts, demo.ts) are unaffected. */
export {
	SOCKET_PATH,
	HARNESS_SOCKET_EVENT,
	type HarnessSocketMessage,
} from "./clientContract";

/** Per-user room. Colon-delimited (socket.io convention); independent of the
 *  dot-delimited NATS subject `conversations.<userId>`. */
export function conversationRoom(userId: string): string {
	return `conversations:${userId}`;
}

/** Events the server emits to clients (keyed by HARNESS_SOCKET_EVENT). */
interface ServerToClientEvents {
	conversation: (message: HarnessSocketMessage) => void;
}

/** Events the client may emit. `sync` re-requests the full_state snapshot — a
 *  recovery lever the UI can pull after a reconnect if it suspects it missed the
 *  connect-time catch-up. */
interface ClientToServerEvents {
	sync: () => void;
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

/**
 * Current state for every in-flight conversation the user owns (one with a live
 * `activeRunId`). DB-authoritative for the run status, enriched with the Redis
 * snapshot (event log + current node) when it's still there.
 *
 * The Redis snapshot's TTL drops to 60s on a terminal/HITL state, so a reconnect
 * a minute later would otherwise find nothing — we synthesize a minimal snapshot
 * from the DB run status so the client ALWAYS gets the current status on
 * (re)connect, even without the event history.
 */
async function currentStateForUser(userId: string): Promise<HarnessSnapshot[]> {
	const rows = await db
		.select({
			conversationId: agentHarnessConversationsEntity.id,
			activeRunId: agentHarnessConversationsEntity.activeRunId,
			runStatus: agentHarnessRunsEntity.status,
		})
		.from(agentHarnessConversationsEntity)
		.leftJoin(
			agentHarnessRunsEntity,
			eq(agentHarnessRunsEntity.id, agentHarnessConversationsEntity.activeRunId),
		)
		.where(
			and(
				eq(agentHarnessConversationsEntity.userId, userId),
				isNotNull(agentHarnessConversationsEntity.activeRunId),
			),
		);

	return Promise.all(
		rows.map(async (r): Promise<HarnessSnapshot> => {
			const snapshot = await redisService.getSnapshot(r.activeRunId!);
			if (snapshot) return snapshot;
			// Snapshot evicted or not yet written: fall back to DB status only.
			return {
				conversationId: r.conversationId,
				runId: r.activeRunId!,
				runStatus: (r.runStatus ?? "queued") as HarnessRunStatus,
				events: [],
				updatedAt: Date.now(),
			};
		}),
	);
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
		ClientToServerEvents,
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

	// Catch-up sent to a single socket: current status of the user's in-flight
	// conversations. Only the connecting/requesting socket, so other tabs aren't
	// re-flooded.
	const sendFullState = async (
		socket: { emit: (e: typeof HARNESS_SOCKET_EVENT, m: HarnessSocketMessage) => void },
		userId: string,
	) => {
		try {
			const conversations = await currentStateForUser(userId);
			socket.emit(HARNESS_SOCKET_EVENT, { type: "full_state", conversations });
			logger.info("[HarnessSocket] Sent full_state", {
				userId,
				conversations: conversations.length,
			});
		} catch (error) {
			logger.error("[HarnessSocket] Failed to send full_state", { userId, error });
		}
	};

	io.on("connection", async (socket) => {
		const userId = socket.data.userId;
		await socket.join(conversationRoom(userId));
		logger.info("[HarnessSocket] Client connected", {
			userId,
			socketId: socket.id,
			room: conversationRoom(userId),
		});

		await sendFullState(socket, userId);

		// Reconnect-recovery: client can re-pull the catch-up at any time.
		socket.on("sync", () => void sendFullState(socket, userId));
	});

	// Live fan-out: every NATS conversation event to its owner's room.
	await subscribeConversations((incoming) => {
		const room = conversationRoom(incoming.userId);

		// An artifact landing is not tied to a live run — a manual apply happens
		// long after its run ended — so it rides the same room as its own kind.
		if (incoming.type === ConversationMsgType.ARTIFACT_STATUS) {
			io.to(room).emit(HARNESS_SOCKET_EVENT, {
				type: "artifact_status",
				status: incoming.status,
			});
			logger.debug("[HarnessSocket] Fanned artifact status", {
				room,
				conversationId: incoming.conversationId,
				outcome: incoming.status.outcome,
			});
			return;
		}

		if (incoming.type === ConversationMsgType.HARNESS_STATS) {
			io.to(room).emit(HARNESS_SOCKET_EVENT, { type: "stats", stats: incoming.stats });
			return;
		}

		if (incoming.type !== ConversationMsgType.HARNESS_EVENT) return;
		const message: HarnessSocketMessage = {
			type: "update",
			conversationId: incoming.conversationId,
			runId: incoming.runId,
			event: incoming.event,
		};
		io.to(room).emit(HARNESS_SOCKET_EVENT, message);
		logger.debug("[HarnessSocket] Fanned update", {
			room,
			conversationId: incoming.conversationId,
			nodeId: incoming.event.nodeId,
			nodeStatus: incoming.event.nodeStatus,
		});
	});

	const handler = engine.handler();
	logger.info(`Initialized on ${SOCKET_PATH}`, "HarnessSocket");
	return {
		fetch: handler.fetch as HarnessSocketHandler["fetch"],
		websocket: handler.websocket,
	};
}
