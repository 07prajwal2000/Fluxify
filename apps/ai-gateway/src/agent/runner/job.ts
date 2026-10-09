import type { ModelMessage, ToolResultPart } from "ai";
import { rejected, type StopReason, stopReason } from "../agent";
import { cacheTokens } from "../cache";
import { continueConversation, pendingCalls } from "../resume";
import type { AgentStore, RunStatus } from "../store";
import { loadedTools } from "../tools";
import { type AgentEvent, batcher, pump, seqTracker } from "./events";
import type { AgentJob } from "./queue";
import type { RunUsage } from "./repository";

type Agent = Parameters<typeof continueConversation>[0]["agent"];

export type RunDeps = {
	store: AgentStore;
	/** queued → executing; false: another job has the run, or it was stopped. */
	claimRun: (runId: string) => Promise<boolean>;
	/** `reason`: the run stopped at a limit. */
	settle: (
		conversationId: string,
		runId: string,
		status: RunStatus,
		reason?: StopReason,
	) => Promise<void>;
	/** The model, tools and limits for the job's project, acting as its user; `loaded`: tools load_tools added earlier in the conversation. */
	build: (job: AgentJob, loaded: Set<string>) => Promise<Omit<Agent, "approve" | "abortSignal">>;
	publish: (runId: string, events: AgentEvent[]) => Promise<void>;
	/** Adds this job's cost to the run (the summary card reads it). */
	addUsage?: (runId: string, usage: RunUsage) => Promise<void>;
	onError?: (e: unknown) => void;
	batchMs?: number;
};

/** What one job cost, once its stream has ended; nothing when the provider reported none. */
async function usageOf(
	result: { totalUsage: PromiseLike<any>; steps: PromiseLike<unknown[]> },
	startedAt: number,
) {
	try {
		const [u, steps] = await Promise.all([result.totalUsage, result.steps]);
		return {
			steps: steps.length,
			inputTokens: u.inputTokens ?? 0,
			outputTokens: u.outputTokens ?? 0,
			cacheReadTokens: cacheTokens(u).read,
			durationMs: Date.now() - startedAt,
		} satisfies RunUsage;
	} catch {}
}

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
	let reason: StopReason | undefined;
	let usage: RunUsage | undefined;
	const startedAt = Date.now();
	try {
		// Every row, summarized or not: a tool loaded before a summary is still loaded.
		const rows = await deps.store.all(job.conversationId);
		const agent = await deps.build(job, loadedTools(rows.map((r) => r.content as ModelMessage)));
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
		if (r.result) usage = await usageOf(r.result, startedAt);
		if (status === "completed") reason = stopReason(r.result?.stopped());
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
	if (usage) await deps.addUsage?.(job.runId, usage).catch(onError);
	await deps.settle(job.conversationId, job.runId, status, reason).catch(onError);
	const seq = t.next - 1;
	events.push(
		error
			? { type: "error", seq, message: error }
			: { type: "done", seq, status, ...(reason && { reason }) },
	);
	await events.flush();
	return status;
}
