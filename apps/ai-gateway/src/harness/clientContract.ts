/* ============================================================================
 * HARNESS CLIENT CONTRACT
 * ----------------------------------------------------------------------------
 * The single module a browser client may import from the harness. It has ZERO
 * runtime imports on purpose: everything below is either an erased `export type`
 * or a plain string constant, so bundling it never drags socket.io, langgraph,
 * drizzle or the DB layer into the frontend bundle (see AGENT.md — "Monorepo
 * Server to Frontend Package Bleed").
 *
 * `socketGateway.ts` re-exports the constants/union from here so the wire
 * contract has exactly one definition.
 * ========================================================================== */

export type {
	HarnessLevel,
	HarnessPhase,
	HarnessRunStatus,
	HarnessTaskView,
	HarnessNodePayload,
	HarnessStreamEvent,
	HarnessSnapshot,
} from "./streamTypes";

export type {
	AgentNodeName,
	Task,
	RouterState,
	VerifyUserQueryState,
	PlannerState,
	DiscussionState,
	SummarizerState,
	SubAgentResult,
	RouteConfigAgentResult,
	BlockBuilderAgentResult,
} from "./types";

import type { HarnessSnapshot, HarnessStreamEvent } from "./streamTypes";

/** Transport path. It sits under `/_/admin/api/ai` — the ONLY prefix every
 *  reverse proxy (Caddyfile.local, docker/admin, docker/kit) already forwards to
 *  the AI gateway on :8001. Anything else, `/_/admin/ai/*` included, falls through
 *  their catch-all to the request worker and never reaches this service.
 *  `main.ts` intercepts this prefix before Hono, so it cannot collide with the
 *  `/_/admin/api/ai/v1/*` REST routes. Clients must connect with this `path`. */
export const SOCKET_PATH = "/_/admin/api/ai/socket.io/";

/** The single socket.io event name; the `type` discriminant inside the payload
 *  tells the client whether it's a catch-up snapshot or a live update. */
export const HARNESS_SOCKET_EVENT = "conversation";

/**
 * Server -> client message, discriminated by `type`:
 *  - `full_state`: sent on every (re)connect — current run state for each active
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

/** Run statuses after which no further events arrive for the current run pass.
 *  `awaiting_hitl` is terminal-but-resumable (resumes as a fresh pass). */
export const TERMINAL_RUN_STATUSES = [
	"completed",
	"failed",
	"interrupted",
	"awaiting_hitl",
] as const;
