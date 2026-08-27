import { logger } from "@fluxify/common";
import { AgentNode, type AgentNodeName, type GlobalGraphState } from "../types";
import type { AgentFactory } from "../models/factory";
import { RunBudget, logRunUsage } from "../models/budget";
import { compactCompletedHistory } from "./historyCompactor";
import type { HarnessService, HitlPlanAction } from "./harnessService";
import type { RedisService } from "./redisService";
import type { HarnessRunContext } from "./runContext";
import { publishHarnessEvent } from "../notifications";
import {
	RUN_NODE,
	labelForNode,
	type HarnessNodeStatus,
	type HarnessRunResult,
	type HarnessRunStatus,
	type HarnessStreamEvent,
} from "../streamTypes";

/**
 * Writes how a run ended — to the database, to the live-state snapshot, and to
 * whoever is listening.
 *
 * Every terminal path shares one shape: settle the run row, keep whatever the
 * graph built, settle the conversation, release the active-run lock, announce
 * it, evict the snapshot. Collecting them here keeps that order in one place;
 * a path that skips a step leaves a conversation stuck "running" with no event
 * to explain it.
 *
 * One instance per run pass: `userId` is resolved once by the caller, and it is
 * the `conversations.<userId>` subject every event for the run is published to.
 */
export class RunOutcomeWriter {
	constructor(
		private readonly ctx: HarnessRunContext,
		private readonly harnessService: HarnessService,
		/** Also the subject the run's per-node events are published to, so the
		 *  caller reads it back off here rather than resolving it twice. */
		readonly userId: string | null,
		private readonly redisService: RedisService,
		private readonly agentFactory: AgentFactory,
	) {}

	/**
	 * Emits a run-level bookend on the synthetic `run` node — the first and last
	 * event of every run, whatever happens in between. The `ended` one carries
	 * the full result (or the failure reason) so a client never has to re-fetch.
	 */
	async emit(
		runStatus: HarnessRunStatus,
		nodeStatus: HarnessNodeStatus,
		message: string,
		result?: Omit<HarnessRunResult, "runStatus">,
	): Promise<void> {
		const event: HarnessStreamEvent = {
			conversationId: this.ctx.conversationId,
			runId: this.ctx.runId,
			currentNode: RUN_NODE,
			nodeId: RUN_NODE,
			nodeStatus,
			executionType: "agent",
			plainTextMessage: message,
			runStatus,
			level: "harness",
			payload:
				nodeStatus === "ended"
					? { node: RUN_NODE, data: { runStatus, ...result } }
					: undefined,
			timestamp: Date.now(),
		};
		try {
			await this.redisService.appendEvent(event);
			if (this.userId) publishHarnessEvent(this.userId, event);
		} catch (e) {
			logger.error("[FluxifyHarness] Error emitting terminal event", {
				runId: this.ctx.runId,
				error: e,
			});
		}
	}

	/**
	 * Persists the terminal outcome of a run. A planner that halts for review
	 * parks the run in `awaiting_hitl` with the markdown plan stored as the run's
	 * `aiResponse` (the final result of the harness pass); anything else that
	 * reaches END completes.
	 */
	async finalize(
		budget: RunBudget,
		toolCalls: number,
		finalState?: Partial<GlobalGraphState>,
	): Promise<void> {
		const usage = logRunUsage(this.ctx, budget, toolCalls);

		if (finalState?.currentAgent === AgentNode.HUMAN_IN_THE_LOOP) {
			await this.parkForReview(finalState, usage);
			return;
		}

		const aiResponse = resolveAiResponse(finalState);
		// A build whose tasks didn't all land is not "All done". The summary still
		// ships as the response — it names what was and wasn't built — but the run
		// must not report success over a route that was never configured.
		const failedTasks = (finalState?.orchestratorState?.tasks ?? []).filter(
			(task) => task.status === "failed",
		);
		const status = failedTasks.length > 0 ? "failed" : "completed";

		await this.harnessService.updateRun({
			runId: this.ctx.runId,
			status,
			aiResponse: aiResponse ?? undefined,
			completedAt: new Date(),
			usage,
		});
		if (status === "completed") {
			await compactCompletedHistory(this.agentFactory, this.harnessService);
		}
		await this.settle(status, finalState);
		await this.emit(status, "ended", describeTaskOutcome(failedTasks.length), {
			result: aiResponse ?? undefined,
			usage,
			artifactId: finalState?.summarizerState?.artifactId,
			error: failedTasks.length
				? failedTasks.map((task) => task.title).join("; ")
				: undefined,
		});
		await this.redisService.finalizeSnapshot(this.ctx.runId);
	}

	/** Persists a run that failed, along with whatever it managed to build. */
	async fail(
		error?: unknown,
		aiResponse?: string,
		node?: AgentNodeName,
		budget?: RunBudget,
		toolCalls = 0,
		graphState?: Partial<GlobalGraphState>,
	): Promise<void> {
		const message =
			error instanceof Error ? error.message : error ? String(error) : "failed";
		const usage = budget && logRunUsage(this.ctx, budget, toolCalls);
		try {
			await this.harnessService.updateRun({
				runId: this.ctx.runId,
				status: "failed",
				aiResponse,
				usage,
			});
			await this.settle("failed", graphState);
			await this.emit("failed", "ended", `Failed at the ${labelForNode(node)}`, {
				result: aiResponse,
				error: message,
				usage: usage || undefined,
			});
			await this.redisService.finalizeSnapshot(this.ctx.runId);
		} catch (e) {
			logger.error("[FluxifyHarness] Error persisting run failure", {
				runId: this.ctx.runId,
				error: e,
			});
		}
	}

	/** Persists a user-interrupted run as `interrupted` with a meaningful response. */
	async interrupt(
		budget: RunBudget,
		toolCalls: number,
		graphState?: Partial<GlobalGraphState>,
	): Promise<void> {
		const message =
			"Conversation was interrupted by the user before it finished.";
		const usage = logRunUsage(this.ctx, budget, toolCalls);
		try {
			await this.harnessService.updateRun({
				runId: this.ctx.runId,
				status: "interrupted",
				aiResponse: message,
				interruptedAt: new Date(),
				usage,
			});
			// An interrupt is the case most worth resuming — the user stopped a run
			// that was working. Keep what it built.
			await this.settle("interrupted", graphState);
			await this.emit("interrupted", "ended", message, {
				result: message,
				usage,
			});
			await this.redisService.finalizeSnapshot(this.ctx.runId);
		} catch (e) {
			logger.error("[FluxifyHarness] Error persisting run interrupt", {
				runId: this.ctx.runId,
				error: e,
			});
		}
	}

	/** Persists a rejected HITL plan as a completed (non-implemented) run. The
	 *  graph is never invoked, so there is no graph state to keep. */
	async reject(
		action: Extract<HitlPlanAction, { type: "reject" }>,
	): Promise<void> {
		await this.emit("queued", "started", "Discarding the plan");
		const aiResponse = `**Plan rejected.** ${
			action.message ? `Reason: ${action.message}` : "No reason was provided."
		} This plan will not be implemented — send a new message to start over.`;

		await this.harnessService.updateRun({
			runId: this.ctx.runId,
			status: "completed",
			aiResponse,
			completedAt: new Date(),
		});
		await compactCompletedHistory(this.agentFactory, this.harnessService);
		await this.harnessService.saveLiveState({
			runId: this.ctx.runId,
			conversationId: this.ctx.conversationId,
			currentState: "completed",
			workingMemory: {},
		});
		await this.harnessService.updateConversationStatus("completed", null);
		await this.redisService.clearActiveRun(this.ctx.conversationId);
		await this.emit("completed", "ended", "Plan rejected", {
			result: aiResponse,
		});
		await this.redisService.finalizeSnapshot(this.ctx.runId);
	}

	private async parkForReview(
		finalState: Partial<GlobalGraphState>,
		usage: ReturnType<typeof logRunUsage>,
	): Promise<void> {
		const markdownPlan = finalState.plannerState?.markdownPlan;
		await this.harnessService.updateRun({
			runId: this.ctx.runId,
			status: "awaiting_hitl",
			aiResponse: markdownPlan,
			interruptedAt: new Date(),
			usage,
		});
		await this.harnessService.saveLiveState({
			runId: this.ctx.runId,
			conversationId: this.ctx.conversationId,
			currentState: "paused_hitl",
			graphState: finalState,
		});
		await this.harnessService.updateConversationStatus(
			"paused_hitl",
			this.ctx.runId,
		);
		await this.emit(
			"awaiting_hitl",
			"ended",
			"Paused — the plan is waiting for your review",
			{ result: markdownPlan, usage },
		);
		// HITL is terminal for this run pass — evict its live-state snapshot soon.
		await this.redisService.finalizeSnapshot(this.ctx.runId);
		logger.info("[FluxifyHarness] Run parked for HITL", {
			runId: this.ctx.runId,
			conversationId: this.ctx.conversationId,
		});
	}

	/**
	 * The three steps every ended run shares: keep what the graph built, settle
	 * the conversation, and release the active-run lock.
	 *
	 * `graphState` is persisted rather than an empty object on purpose —
	 * everything the sub-agents produced up to this point lives there, and it is
	 * what a resume reads back. Erasing it made every failure a full restart from
	 * the planner.
	 */
	private async settle(
		currentState: "completed" | "failed" | "interrupted",
		graphState?: Partial<GlobalGraphState>,
	): Promise<void> {
		await this.harnessService.saveLiveState({
			runId: this.ctx.runId,
			conversationId: this.ctx.conversationId,
			currentState,
			graphState,
		});
		await this.harnessService.updateConversationStatus(currentState, null);
		await this.redisService.clearActiveRun(this.ctx.conversationId);
	}
}

/**
 * The run's closing message, in order of how directly it answers the user.
 *
 * The `rejectReason` tail is what a router rejection ends on: without it an
 * unbuildable request completes with no message at all and the user never
 * learns why.
 */
function resolveAiResponse(
	finalState?: Partial<GlobalGraphState>,
): string | null {
	return (
		finalState?.summarizerState?.markdown ??
		finalState?.discussionState?.markdown ??
		finalState?.plannerState?.markdownPlan ??
		finalState?.routerState?.rejectReason ??
		null
	);
}

function describeTaskOutcome(failedCount: number): string {
	if (failedCount === 0) return "All done";
	return `Finished with ${failedCount} unfinished task${failedCount === 1 ? "" : "s"}`;
}
