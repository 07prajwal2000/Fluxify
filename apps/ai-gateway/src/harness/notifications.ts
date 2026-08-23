import { z } from "zod";
import { logger } from "@fluxify/common";
import { publishMessage, subscribeToChannel } from "@fluxify/server";
import type { HarnessStreamEvent } from "./streamTypes";
import type { ArtifactStatus, HarnessRunStats } from "./clientContract";

/* ============================================================================
 * CONVERSATION PUB/SUB CONTRACT (NATS)
 * ----------------------------------------------------------------------------
 * Harness progress is published to `conversations.<userId>` — one subject per
 * conversation owner, since a user may run several harness sessions at once and
 * a single subscription per user is enough to fan updates out to their sockets.
 *
 * A gateway subscribes to the wildcard `conversations.*` and (future) routes
 * each message to a socket.io room keyed by userId, using `conversationId` in
 * the payload to target the right conversation. Messages are a discriminated
 * union on `type` so new message kinds stay type-safe and easy to parse.
 * ========================================================================== */

export const CONVERSATIONS_SUBJECT_PREFIX = "conversations";
export const CONVERSATIONS_WILDCARD = `${CONVERSATIONS_SUBJECT_PREFIX}.*`;

/** Subject carrying a single conversation-owner's live updates. */
export function conversationSubject(userId: string): string {
	return `${CONVERSATIONS_SUBJECT_PREFIX}.${userId}`;
}

/** Discriminant for the conversation message union. */
export const ConversationMsgType = {
	HARNESS_EVENT: "harness_event",
	HARNESS_STATS: "harness_stats",
	ARTIFACT_STATUS: "artifact_status",
} as const;

/** The harness stream event is produced internally and already TS-typed, so it
 *  is carried through rather than re-validated field-by-field; the guard only
 *  rejects clearly-foreign payloads that land on the wildcard subject. */
const harnessStreamEventSchema = z.custom<HarnessStreamEvent>(
	(v) =>
		typeof v === "object" &&
		v !== null &&
		typeof (v as { conversationId?: unknown }).conversationId === "string",
);

const harnessEventMessageSchema = z.object({
	type: z.literal(ConversationMsgType.HARNESS_EVENT),
	userId: z.string(),
	conversationId: z.string(),
	runId: z.string(),
	timestamp: z.number(),
	event: harnessStreamEventSchema,
});

/** All message shapes carried on the conversation subject. Extend the union as
 *  new kinds are added — the `type` discriminant keeps consumers type-safe. */
const artifactStatusMessageSchema = z.object({
	type: z.literal(ConversationMsgType.ARTIFACT_STATUS),
	userId: z.string(),
	conversationId: z.string(),
	status: z.custom<ArtifactStatus>(
		(v) =>
			typeof v === "object" &&
			v !== null &&
			typeof (v as { message?: unknown }).message === "string",
	),
});

const harnessStatsMessageSchema = z.object({
	type: z.literal(ConversationMsgType.HARNESS_STATS),
	userId: z.string(),
	conversationId: z.string(),
	runId: z.string(),
	stats: z.custom<HarnessRunStats>(
		(v) =>
			typeof v === "object" &&
			v !== null &&
			typeof (v as { toolCalls?: unknown }).toolCalls === "number",
	),
});

export const conversationMessageSchema = z.discriminatedUnion("type", [
	harnessEventMessageSchema,
	harnessStatsMessageSchema,
	artifactStatusMessageSchema,
]);

export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type HarnessEventMessage = z.infer<typeof harnessEventMessageSchema>;
export type HarnessStatsMessage = z.infer<typeof harnessStatsMessageSchema>;
export type ArtifactStatusMessage = z.infer<typeof artifactStatusMessageSchema>;

/** Publishes a harness stream event to its owner's conversation subject. */
export function publishHarnessEvent(
	userId: string,
	event: HarnessStreamEvent,
): void {
	const message: HarnessEventMessage = {
		type: ConversationMsgType.HARNESS_EVENT,
		userId,
		conversationId: event.conversationId,
		runId: event.runId,
		timestamp: event.timestamp,
		event,
	};
	// `publishMessage` is async, so a sync try/catch around it never fires — the
	// rejection just escapes as an unhandled one. Fire-and-forget needs .catch().
	void publishMessage(conversationSubject(userId), message).catch((error) => {
		logger.error("[Conversations] Failed to publish harness event", {
			userId,
			runId: event.runId,
			error,
		});
	});
}

/** Publishes current in-memory run counters. These are intentionally ephemeral:
 * the terminal usage record remains the durable accounting source. */
export function publishHarnessStats(userId: string, stats: HarnessRunStats): void {
	const message: HarnessStatsMessage = {
		type: ConversationMsgType.HARNESS_STATS,
		userId,
		conversationId: stats.conversationId,
		runId: stats.runId,
		stats,
	};
	void publishMessage(conversationSubject(userId), message).catch((error) => {
		logger.error("[Conversations] Failed to publish harness stats", {
			userId,
			runId: stats.runId,
			error,
		});
	});
}

/**
 * Publishes one artifact lifecycle event. Fire-and-forget on purpose: the
 * apply already succeeded (or already failed) by the time this runs, and a
 * broker hiccup must not turn a good apply into an error the user sees.
 */
export function publishArtifactStatus(
	userId: string,
	status: ArtifactStatus,
): void {
	const message: ArtifactStatusMessage = {
		type: ConversationMsgType.ARTIFACT_STATUS,
		userId,
		conversationId: status.conversationId,
		status,
	};
	void publishMessage(conversationSubject(userId), message).catch((error) => {
		logger.error("[Conversations] Failed to publish artifact status", {
			userId,
			subArtifactId: status.subArtifactId,
			error,
		});
	});
}

/** Subscribes to every conversation owner's updates (`conversations.*`),
 *  validating each message before handing it off. Returns an async unsubscribe. */
export async function subscribeConversations(
	handler: (message: ConversationMessage) => void,
): Promise<() => Promise<void>> {
	return subscribeToChannel(CONVERSATIONS_WILDCARD, (raw) => {
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch (error) {
			logger.warn("[Conversations] Dropped non-JSON message", { error });
			return;
		}
		const parsed = conversationMessageSchema.safeParse(json);
		if (!parsed.success) {
			logger.warn("[Conversations] Dropped malformed message", {
				error: parsed.error.message,
			});
			return;
		}
		handler(parsed.data);
	});
}
