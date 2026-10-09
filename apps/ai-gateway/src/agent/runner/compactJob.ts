import { agentPrompt } from "../agent";
import { summarize } from "../compact";
import type { RunStatus } from "../store";
import { withModelTimeouts } from "../timeouts";
import { batcher, compactionEvent, seqTracker } from "./events";
import type { RunDeps } from "./job";
import type { AgentJob } from "./queue";

/**
 * The compact job (/compact): claims the run, summarizes the conversation (what
 * the job's `keep` asks for goes into the summary prompt), saves the summary row
 * and streams one compaction event, then `done`. No model turn follows. A
 * failed summary is a `summary-failed` compaction, not a failed run: the
 * conversation is as it was and the next message goes on.
 */
export async function executeCompact(job: AgentJob, deps: RunDeps, signal: AbortSignal) {
	if (!(await deps.claimRun(job.runId))) return "skipped" as const;
	const onError = deps.onError ?? (() => {});
	const events = batcher((e) => deps.publish(job.runId, e), onError, deps.batchMs);
	const { t, store } = seqTracker(deps.store);
	let status: RunStatus = "completed";
	try {
		const view = await store.modelView(job.conversationId);
		// Only get_canvas is used, for the summary to re-attach the edited canvases; it is always loaded.
		const { model, limits, tools } = await deps.build(job, new Set());
		const r = await summarize(
			withModelTimeouts(model, limits, () => {}),
			view.map((v) => v.message),
			{ instructions: agentPrompt(job.projectId), keep: job.keep, tools, abortSignal: signal },
		);
		if (r) {
			const covers = Math.max(...view.slice(0, r.event.coversUpTo).map((v) => v.seq));
			await store.appendSummary(job.conversationId, job.runId, r.messages[0], covers, r.event);
			events.push(compactionEvent(r.event, t));
		}
	} catch (e) {
		if (signal.aborted) status = "interrupted";
		else {
			const error = e instanceof Error ? e.message : String(e);
			events.push(compactionEvent({ type: "compaction", kind: "summary-failed", error }, t));
		}
	}
	await deps.store.setRunStatus(job.runId, status).catch(onError);
	await deps.settle(job.conversationId, job.runId, status).catch(onError);
	events.push({ type: "done", seq: t.next - 1, status });
	await events.flush();
	return status;
}
