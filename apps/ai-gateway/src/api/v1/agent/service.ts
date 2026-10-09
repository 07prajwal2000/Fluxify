import { ConflictError, db } from "@fluxify/server";
import type { Effort } from "../../../agent/model";
import { projectSupportsThinking } from "../../../agent/runner/integration";
import { rejectPending } from "../../../agent/runner/job";
import { publishAgentJob, purgeRunEvents, requestStop } from "../../../agent/runner/queue";
import {
	type AgentMeta,
	type Conversation,
	claimContinue,
	deleteConversation,
	getRun,
	interruptIdle,
	setMeta,
	startRun,
	updateConversation,
} from "../../../agent/runner/repository";
import { agentStore } from "../../../agent/store";
import type { Mode } from "../../../agent/tools";
import { assertRunQuota } from "../harness-conversations/send-message/rateLimit";

const store = () => agentStore(db);

const metaOf = (c: Conversation) => (c.metadata ?? {}) as Partial<AgentMeta>;

/**
 * Every saved message (#645 rows), the active run, if any, and the picker
 * settings: the mode and effort the conversation went on with last, and whether
 * the project's model takes a thinking setting.
 */
export async function getConversationDetail(conversation: Conversation) {
	const [messages, run, supportsThinking] = await Promise.all([
		store().all(conversation.id),
		conversation.activeRunId ? getRun(conversation.activeRunId) : undefined,
		projectSupportsThinking(conversation.projectId as string),
	]);
	const { mode = "manual", effort = "none" } = metaOf(conversation);
	return { conversation, messages, run: run ?? null, settings: { mode, effort, supportsThinking } };
}

/** Starts a run on the user's message; one run per conversation at a time. */
export async function sendMessage(
	conversation: Conversation,
	userId: string,
	text: string,
	mode: Mode,
	effort: Effort | undefined = metaOf(conversation).effort,
) {
	if (conversation.archived)
		throw new ConflictError("Cannot send a message to an archived conversation");
	await assertRunQuota(userId);
	const runId = await startRun(conversation.id, text, mode, effort);
	if (!runId) throw new ConflictError("This conversation already has a run in progress");
	await publishAgentJob({
		type: "start",
		conversationId: conversation.id,
		runId,
		userId,
		projectId: conversation.projectId as string,
		mode,
		effort,
		message: text,
	});
	return { runId };
}

/** Answers the first waiting call; the run goes on in a new job. */
export async function answerApproval(
	conversation: Conversation,
	userId: string,
	approval: { approve: boolean; reason?: string; mode?: Mode; effort?: Effort },
) {
	const runId = conversation.activeRunId;
	if (!runId || !(await claimContinue(conversation.id, runId)))
		throw new ConflictError("This conversation is not waiting for an approval");
	// The approval can pick the mode the conversation goes on in ("Approve with Auto").
	const meta = metaOf(conversation);
	const mode = approval.mode ?? meta.mode ?? "manual";
	const effort = approval.effort ?? meta.effort;
	if (mode !== meta.mode || effort !== meta.effort)
		await setMeta(conversation.id, { agent: true, mode, ...(effort && { effort }) });
	// The finished part's `done` must not end the stream of the part that follows.
	await purgeRunEvents(runId);
	await publishAgentJob({
		type: "continue",
		conversationId: conversation.id,
		runId,
		userId,
		projectId: conversation.projectId as string,
		mode,
		effort,
		approval: { ok: approval.approve, reason: approval.reason },
	});
	return { runId };
}

/**
 * Stops the active run. A queued or waiting run has no job: it is marked
 * interrupted here (waiting calls rejected). A running one is aborted by its
 * worker, which saves `interrupted` itself.
 */
export async function stopRun(conversation: Conversation) {
	const runId = conversation.activeRunId;
	if (!runId) throw new ConflictError("This conversation has no run to stop");
	if (await interruptIdle(conversation.id, runId))
		await rejectPending(store(), conversation.id, runId, "the user stopped the run");
	else requestStop(conversation.id);
	return { runId };
}

/** Rename, pin or archive. Archiving unpins; an archived conversation cannot be pinned. */
export async function patchConversation(
	conversation: Conversation,
	patch: { title?: string; pinned?: boolean; archived?: boolean },
) {
	const archived = patch.archived ?? conversation.archived;
	if (patch.pinned && archived) throw new ConflictError("Cannot pin an archived conversation");
	return updateConversation(conversation.id, { ...patch, ...(archived && { pinned: false }) });
}

/** Deletes the conversation with its messages and runs; not while a run is in progress. */
export async function removeConversation(conversation: Conversation) {
	if (conversation.status === "running")
		throw new ConflictError("Stop the run before deleting this conversation");
	await deleteConversation(conversation.id);
	return { success: true };
}
