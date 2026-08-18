import { io, type Socket } from "socket.io-client";
import {
	HARNESS_SOCKET_EVENT,
	SOCKET_PATH,
	type HarnessSocketMessage,
} from "@fluxify/ai-gateway/src/harness/clientContract";
import { toast } from "@fluxify/components";
import { useAiHarnessStore } from "@/store/aiHarness";

/* ============================================================================
 * HARNESS SOCKET TRANSPORT
 * ----------------------------------------------------------------------------
 * One socket per browser tab, ref-counted so several mounted consumers share it.
 * Same origin as the app: in dev vite proxies `/_/admin/api/ai` to the gateway
 * on :8001, in prod Caddy does — `SOCKET_PATH` sits under that prefix precisely
 * so both already forward it.
 *
 * Auth is the better-auth session cookie, sent automatically on the handshake —
 * `withCredentials: true` is what makes that happen; there is nothing to set by
 * hand. A missing/expired session is refused during the handshake and surfaces
 * as `connect_error` with message "unauthorized".
 *
 * The transport does exactly two things: own the connection lifecycle, and push
 * every message into the store. All interpretation lives in the store reducer.
 * ========================================================================== */

let socket: Socket | null = null;
let refCount = 0;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

/** React StrictMode mounts → unmounts → remounts effects in dev. Deferring the
 *  close briefly keeps that from churning a fresh handshake + full_state. */
const CLOSE_GRACE_MS = 500;

function createSocket(): Socket {
	const store = () => useAiHarnessStore.getState();
	const next = io(window.location.origin, {
		path: SOCKET_PATH,
		withCredentials: true,
		reconnection: true,
		reconnectionAttempts: Infinity,
		reconnectionDelay: 1000,
		reconnectionDelayMax: 5000,
	});

	next.on("connect", () => store().setConnected(true));
	// Keep the data on disconnect — only flag the UI. Anything that happened
	// while we were away arrives in the next connect's `full_state`.
	next.on("disconnect", () => store().setConnected(false));
	next.on("connect_error", (error: Error) => {
		store().setConnected(false);
		store().setConnectionError(error.message);
		// "unauthorized" = no/expired session. Anything else is almost always the
		// handshake not reaching the gateway (proxy route / wrong origin).
		console.warn(
			`[harness-socket] connect_error: ${error.message} (${window.location.origin}${SOCKET_PATH})`,
		);
	});
	// One listener, one entry point. No per-render rebinding, no stale closures:
	// the handler reads the store imperatively.
	next.on(HARNESS_SOCKET_EVENT, (message: HarnessSocketMessage) => {
		// An artifact landing is a notification, not run state — it can arrive
		// long after the run that produced it ended, so it never touches `runs`.
		if (message.type === "artifact_status") {
			const { outcome, message: text, reason } = message.status;
			if (outcome === "applied") toast.success(text);
			else toast.danger(reason ? `${text} — ${reason}` : text);
			return;
		}
		store().applySocketMessage(message);
	});

	return next;
}

/** Opens (or joins) the shared socket. Returns the disposer. */
export function openHarnessSocket(): () => void {
	refCount++;
	if (closeTimer) {
		clearTimeout(closeTimer);
		closeTimer = null;
	}
	socket ??= createSocket();

	return () => {
		refCount = Math.max(0, refCount - 1);
		if (refCount > 0) return;
		closeTimer = setTimeout(() => {
			closeTimer = null;
			if (refCount > 0) return;
			socket?.removeAllListeners();
			socket?.disconnect();
			socket = null;
			useAiHarnessStore.getState().setConnected(false);
		}, CLOSE_GRACE_MS);
	};
}

/** Escape hatch for client→server emits once the server accepts any. */
export function getHarnessSocket(): Socket | null {
	return socket;
}
