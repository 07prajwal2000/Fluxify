import type { ModelMessage, ToolResultPart } from "ai";
import { rejected } from "../agent";
import { continueConversation, pendingCalls } from "../resume";
import type { AgentStore, RunStatus } from "../store";
import { type AgentEvent, batcher, pump, seqTracker } from "./events";
import type { AgentJob } from "./queue";

type Agent = Parameters<typeof continueConversation>[0]["agent"];

export type RunDeps = {
	store: AgentStore;
	/** queued → executing; false: another job has the run, or it was stopped. */
	claimRun: (runId: string) => Promise<boolean>;
	settle: (conversationId: string, runId: string, status: RunStatus) => Promise<void>;
	/** The model, tools and limits for the job's project, acting as its user. */
	build: (job: AgentJob) => Promise<Omit<Agent, "approve" | "abortSignal">>;
	publish: (runId: string, events: AgentEvent[]) => Promise<void>;
	onError?: (e: unknown) => void;
	batchMs?: number;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Answers every call still waiting with a rejection, so the next message can
 * run. A run that ends any other way than waiting_approval leaves none.
 */
export async function rejectPending(
	store: AgentStore,
	conversationId: string,
	runId: string,
	reason: string,
) {
	const view = await store.modelView(conversationId);
	const calls = pendingCalls(view.map((v) => v.message));
	if (!calls.length) return;
	const content: ToolResultPart[] = calls.map((c) => ({
		type: "tool-result",
		toolCallId: c.toolCallId,
		toolName: c.toolName,
		output: { type: "execution-denied", reason: rejected(c.toolName, reason) },
	}));
	await store.append(conversationId, runId, [{ role: "tool", content } as ModelMessage]);
}

/**
 * One job: claims the run, continues the conversation (saving each message to
 * Postgres as it finishes) and streams events. A call that needs approval is
 * deferred: the run saves waiting_approval and the job ends, after the
 * approval event went out. `done` (or `error`) is published last, once the
 * messages and the status are saved, so a client that sees it can reload.
 */
export async function executeRun(job: AgentJob, deps: RunDeps, signal: AbortSignal) {
	if (!(await deps.claimRun(job.runId))) return "skipped" as const;
	const onError = deps.onError ?? (() => {});
	const events = batcher((e) => deps.publish(job.runId, e), onError, deps.batchMs);
	const { t, store } = seqTracker(deps.store);
	let status: RunStatus;
	let error = "";
	try {
		const agent = await deps.build(job);
		const r = await continueConversation({
			store,
			conversationId: job.conversationId,
			runId: job.runId,
			agent: { ...agent, approve: async () => ({ ok: false, defer: true }), abortSignal: signal },
			message: job.message,
			approval: job.approval,
		});
		if (r.result) await pump(r.result, t, events.push).catch(onError);
		status = await r.status;
	} catch (e) {
		error = message(e);
		status = "failed";
		await deps.store.setRunStatus(job.runId, "failed").catch(onError);
	}
	if (status !== "waiting_approval")
		await rejectPending(
			store,
			job.conversationId,
			job.runId,
			status === "interrupted" ? "the user stopped the run" : "the run failed",
		).catch(onError);
	await deps.settle(job.conversationId, job.runId, status).catch(onError);
	const seq = t.next - 1;
	events.push(error ? { type: "error", seq, message: error } : { type: "done", seq, status });
	await events.flush();
	return status;
}
