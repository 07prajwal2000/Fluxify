import { ConflictError, db } from "@fluxify/server";
import { canCompact } from "../../../agent/compact";
import type { Effort } from "../../../agent/model";
import { pendingCalls } from "../../../agent/resume";
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
import { assertRunQuota } from "./rateLimit";

const store = () => agentStore(db);

const metaOf = (c: Conversation) => (c.metadata ?? {}) as Partial<AgentMeta>;

/** The 50 saved messages before `beforeSeq`, for scrolling up. */
export const getOlderMessages = (conversation: Conversation, beforeSeq: number) =>
	store().page(conversation.id, beforeSeq);

/**
 * The latest page of saved messages (#645 rows) with `nextBeforeSeq` for the
 * older ones, the active run, if any, and the picker settings: the mode and
 * effort the conversation went on with last, and whether the project's model
 * takes a thinking setting.
 */
export async function getConversationDetail(conversation: Conversation) {
	const [{ messages, nextBeforeSeq }, run, supportsThinking] = await Promise.all([
		store().page(conversation.id),
		conversation.activeRunId ? getRun(conversation.activeRunId) : undefined,
		projectSupportsThinking(conversation.projectId as string),
	]);
	const { mode = "manual", effort = "none" } = metaOf(conversation);
	return {
		conversation,
		messages,
		nextBeforeSeq,
		run: run ?? null,
		settings: { mode, effort, supportsThinking },
	};
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

/**
 * /compact: summarizes the conversation as a job of its own, with no model turn
 * after it. It takes the same run lock as a message, so it is refused while a run
 * is active or waiting for an approval. Nothing to summarize yet: no job, `runId` null.
 */
export async function compactConversation(
	conversation: Conversation,
	userId: string,
	keep?: string,
): Promise<{ runId: string } | { runId: null; message: string }> {
	if (conversation.archived) throw new ConflictError("Cannot compact an archived conversation");
	const busy = new ConflictError(
		"Wait for the current run to finish (or answer its approval) before compacting",
	);
	if (conversation.status === "running" || conversation.status === "paused_hitl") throw busy;
	const view = await store().modelView(conversation.id);
	if (!canCompact(view.map((v) => v.message)))
		return { runId: null, message: "Nothing to compact yet" };
	await assertRunQuota(userId);
	const meta = metaOf(conversation);
	// The run row holds the lock; the picker settings stay as they were.
	const runId = await startRun(
		conversation.id,
		keep ? `/compact ${keep}` : "/compact",
		meta.mode ?? "manual",
		meta.effort,
	);
	if (!runId) throw busy;
	await publishAgentJob({
		type: "compact",
		conversationId: conversation.id,
		runId,
		userId,
		projectId: conversation.projectId as string,
		mode: meta.mode ?? "manual",
		effort: meta.effort,
		keep,
	});
	return { runId };
}

/** Answers the first waiting call; the run goes on in a new job. */
export type Decision = { toolCallId: string; approve: boolean; reason?: string };

export async function answerApproval(
	conversation: Conversation,
	userId: string,
	approval: { mode?: Mode; effort?: Effort } & (
		| { approve: boolean; reason?: string; decisions?: undefined }
		| { decisions: Decision[] }
	),
) {
	const runId = conversation.activeRunId;
	if (approval.decisions) {
		const pending = new Set(
			pendingCalls((await store().modelView(conversation.id)).map((v) => v.message)).map(
				(c) => c.toolCallId,
			),
		);
		const stale = approval.decisions.filter((d) => !pending.has(d.toolCallId));
		if (stale.length)
			throw new ConflictError(
				`Not waiting for an approval: ${stale.map((d) => d.toolCallId).join(", ")}`,
			);
	}
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
		...(approval.decisions
			? {
					decisions: approval.decisions.map((d) => ({
						toolCallId: d.toolCallId,
						ok: d.approve,
						reason: d.reason,
					})),
				}
			: { approval: { ok: approval.approve, reason: approval.reason } }),
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
