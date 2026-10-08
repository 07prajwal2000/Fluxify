import { ConflictError, db } from "@fluxify/server";
import { rejectPending } from "../../../agent/runner/job";
import { publishAgentJob, purgeRunEvents, requestStop } from "../../../agent/runner/queue";
import {
	type AgentMeta,
	type Conversation,
	claimContinue,
	getRun,
	interruptIdle,
	startRun,
} from "../../../agent/runner/repository";
import { agentStore } from "../../../agent/store";
import type { Mode } from "../../../agent/tools";
import { assertRunQuota } from "../harness-conversations/send-message/rateLimit";

const store = () => agentStore(db);

/** Every saved message (#645 rows) and the active run, if any. */
export async function getConversationDetail(conversation: Conversation) {
	const [messages, run] = await Promise.all([
		store().all(conversation.id),
		conversation.activeRunId ? getRun(conversation.activeRunId) : undefined,
	]);
	return { conversation, messages, run: run ?? null };
}

/** Starts a run on the user's message; one run per conversation at a time. */
export async function sendMessage(
	conversation: Conversation,
	userId: string,
	text: string,
	mode: Mode,
) {
	if (conversation.archived)
		throw new ConflictError("Cannot send a message to an archived conversation");
	await assertRunQuota(userId);
	const runId = await startRun(conversation.id, text, mode);
	if (!runId) throw new ConflictError("This conversation already has a run in progress");
	await publishAgentJob({
		type: "start",
		conversationId: conversation.id,
		runId,
		userId,
		projectId: conversation.projectId as string,
		mode,
		message: text,
	});
	return { runId };
}

/** Answers the first waiting call; the run goes on in a new job. */
export async function answerApproval(
	conversation: Conversation,
	userId: string,
	approval: { approve: boolean; reason?: string },
) {
	const runId = conversation.activeRunId;
	if (!runId || !(await claimContinue(conversation.id, runId)))
		throw new ConflictError("This conversation is not waiting for an approval");
	// The finished part's `done` must not end the stream of the part that follows.
	await purgeRunEvents(runId);
	await publishAgentJob({
		type: "continue",
		conversationId: conversation.id,
		runId,
		userId,
		projectId: conversation.projectId as string,
		mode: (conversation.metadata as AgentMeta | null)?.mode ?? "manual",
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
