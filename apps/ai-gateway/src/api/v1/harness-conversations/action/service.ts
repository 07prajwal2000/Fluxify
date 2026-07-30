import { BadRequestError, ConflictError } from "@fluxify/server";
import { setConversationFlags } from "./repository";
import { bumpListCacheVersion } from "../cacheVersion";
import { requestInterrupt } from "../../../../harness/interrupt";
import { enqueueHarnessContinue } from "../../../../harness/internal/enqueue";
import type { HitlPlanAction } from "../../../../harness/internal/harnessService";
import type { ConversationAction, ConversationActionBody } from "./dto";

/** The conversation row the middleware loaded (fields this handler needs). */
interface ActionConversation {
	id: string;
	userId: string | null;
	projectId: string | null;
	archived: boolean;
	status: string;
	activeRunId: string | null;
}

const FLAG_ACTIONS = new Set<ConversationAction>([
	"pin",
	"unpin",
	"archive",
	"unarchive",
]);

/** Archiving always clears pinned (an archived conversation can't be pinned);
 *  pinning an already-archived conversation is rejected instead of silently
 *  un-archiving it. */
function resolveFlags(
	action: ConversationAction,
	currentlyArchived: boolean,
): { pinned?: boolean; archived?: boolean } {
	switch (action) {
		case "pin":
			if (currentlyArchived) {
				throw new ConflictError("Cannot pin an archived conversation");
			}
			return { pinned: true };
		case "unpin":
			return { pinned: false };
		case "archive":
			return { archived: true, pinned: false };
		case "unarchive":
			return { archived: false };
		default:
			throw new BadRequestError(`Unsupported flag action: ${action}`);
	}
}

/** Maps a hitl_* action + review body to the harness HITL decision. */
function resolveHitlAction(
	action: ConversationAction,
	body: ConversationActionBody,
): HitlPlanAction {
	switch (action) {
		case "hitl_approve":
			return { type: "approve" };
		case "hitl_reject":
			return { type: "reject", message: "Rejected by the user" };
		case "hitl_review":
			return { type: "review", comments: body.hitl_review?.reviews ?? [] };
		default:
			throw new BadRequestError(`Unsupported HITL action: ${action}`);
	}
}

export default async function handleRequest(
	conversationId: string,
	body: ConversationActionBody,
	conversation: ActionConversation,
) {
	const { action } = body;

	if (FLAG_ACTIONS.has(action)) {
		const flags = resolveFlags(action, conversation.archived);
		const result = await setConversationFlags(conversationId, flags);
		if (conversation.userId) await bumpListCacheVersion(conversation.userId);
		return result;
	}

	if (action === "user_interrupt") {
		// Only a running graph can be interrupted; the worker aborts it and
		// finalizes the run as `interrupted`.
		if (conversation.status !== "running") {
			throw new ConflictError("Conversation is not running");
		}
		requestInterrupt(conversationId);
		return { id: conversationId, status: "interrupting" };
	}

	// hitl_* — only valid while the run is parked awaiting review. Resume it via a
	// `continue` job carrying the user's decision.
	if (conversation.status !== "paused_hitl" || !conversation.activeRunId) {
		throw new ConflictError("Conversation is not awaiting review");
	}
	await enqueueHarnessContinue({
		conversationId,
		runId: conversation.activeRunId,
		action: resolveHitlAction(action, body),
		metadata: {
			projectId: conversation.projectId ?? undefined,
			userId: conversation.userId ?? undefined,
		},
	});
	return { id: conversationId, status: "resuming" };
}
