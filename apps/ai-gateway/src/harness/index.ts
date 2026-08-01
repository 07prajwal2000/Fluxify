import type { Job } from "bullmq";
import { logger } from "@fluxify/common";
import { withFluxifyContext } from "@fluxify/common/tracing";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import {
	AgentFactory,
	type AgentFactoryOptions,
	type AgentProvider,
} from "./models/factory";
import {
	GraphState,
	AgentNode,
	type GlobalGraphState,
	type AgentNodeName,
	type CustomEventName,
} from "./types";
import { BaseAgentWrapper, type AgentInvokeOptions } from "./models/base";
import { app as graphApp } from "./graph";
import { DbService } from "./internal/dbService";
import { buildContextBlock } from "./internal/contextBlock";
import {
	extractWorkingMemory,
	HarnessService,
	HitlPlanAction,
	RecordHitlActionInput,
	SaveLiveStateInput,
	UpsertStepInput,
} from "./internal/harnessService";
import { RedisService } from "./internal/redisService";
import { FluxifyOtelTracer } from "./telemetry/otel-tracer";
import { HarnessCallbacks } from "./callbacks";
import {
	RUN_NODE,
	labelForNode,
	runStatusForNode,
	type HarnessNodeStatus,
	type HarnessRunResult,
	type HarnessRunStatus,
	type HarnessStreamEvent,
} from "./streamTypes";
import { publishHarnessEvent } from "./notifications";
import { isUserInterrupt, explainErrorReason } from "./errors";
import {
	registerRunController,
	unregisterRunController,
	requestInterrupt,
} from "./interrupt";
import type { HarnessJobData, HarnessJobMetadata } from "./queue";

/**
 * Best-effort message for anything thrown. Provider SDKs sometimes reject with
 * plain objects (`{ code: 23, ... }`) whose `String()` is "[object Object]".
 */
function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message || error.name;
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		const e = error as Record<string, any>;
		const parts = [e.message, e.error?.message, e.code, e.name].filter(
			(p) => typeof p === "string" && p.length > 0,
		);
		if (parts.length > 0) return parts.join(" ");
		try {
			return JSON.stringify(error).slice(0, 500);
		} catch {
			return "Unknown error";
		}
	}
	return String(error ?? "Unknown error");
}

/**
 * Turns a thrown error into a short, user-readable explanation of why the run
 * failed. Persisted as the run's `aiResponse` so the UI shows something more
 * useful than a bare `failed` status.
 */
export function describeFailure(error: unknown, node?: AgentNodeName): string {
	const raw = errorMessage(error);
	const where = labelForNode(node);
	const reason = explainErrorReason(raw);

	return `This request could not be completed — it failed at the **${where}** step because ${reason}\n\nDetails: ${raw.slice(0, 500)}`;
}

/** Turns a HITL decision into the human turn the router/planner actually read
 *  ("check message history" per the planner prompt) — `state.action` itself is
 *  never inspected by any graph node, so this is the only path review
 *  comments have into the model. */
function describeHitlAction(action: HitlPlanAction): string | undefined {
	switch (action.type) {
		case "approve":
			return "I approve this plan. Proceed with implementation.";
		case "reject":
			return `I reject this plan.${action.message ? ` Reason: ${action.message}` : ""}`;
		case "review": {
			if (!action.comments?.length) return undefined;
			const comments = action.comments.map((c) =>
				typeof c === "string" ? c : c.text,
			);
			return `Please revise the plan based on my feedback:\n${comments.map((c) => `- ${c}`).join("\n")}`;
		}
		default:
			return undefined;
	}
}

/** Everything a single harness run needs — supplied by the worker from job data. */
export interface HarnessRunContext {
	conversationId: string;
	runId: string;
	query?: string;
	action?: HitlPlanAction;
	metadata?: HarnessJobMetadata;
	job?: Job<HarnessJobData>;
}

export class FluxifyHarness {
	private graph = graphApp;
	private dbService: DbService;
	private agentFactory: AgentFactory;
	private callbacksClass: typeof HarnessCallbacks;
	private redisService = new RedisService();

	constructor(
		agentFactory: AgentFactory,
		dbService: DbService = new DbService(),
		callbacksClass: typeof HarnessCallbacks = HarnessCallbacks,
	) {
		this.agentFactory = agentFactory;
		this.dbService = dbService;
		this.callbacksClass = callbacksClass;
	}

	public async start(ctx: HarnessRunContext) {
		const state = await this.buildState(ctx, "start");
		return await this.executeGraph(ctx, state);
	}

	public async continue(ctx: HarnessRunContext) {
		// `reject` throws the plan away outright — there's nothing left for the
		// graph to do, so skip it entirely instead of paying for a router/verify/
		// planner cycle just to land back on the same rejected plan.
		if (ctx.action?.type === "reject") {
			return await this.rejectRun(ctx, ctx.action);
		}
		const state = await this.buildState(ctx, "continue");
		return await this.executeGraph(ctx, state);
	}

	/** Persists a rejected HITL plan as a completed (non-implemented) run,
	 *  without invoking the graph. */
	private async rejectRun(
		ctx: HarnessRunContext,
		action: Extract<HitlPlanAction, { type: "reject" }>,
	) {
		const harnessService = new HarnessService(ctx.conversationId);
		const userId = await harnessService.getOwnerUserId();
		await this.emitRunEvent(ctx, userId, "queued", "started", "Discarding the plan");
		const aiResponse = `**Plan rejected.** ${
			action.message
				? `Reason: ${action.message}`
				: "No reason was provided."
		} This plan will not be implemented — send a new message to start over.`;

		await harnessService.updateRun({
			runId: ctx.runId,
			status: "completed",
			aiResponse,
			completedAt: new Date(),
		});
		await harnessService.saveLiveState({
			runId: ctx.runId,
			conversationId: ctx.conversationId,
			currentState: "completed",
			workingMemory: {},
		});
		await harnessService.updateConversationStatus("completed", null);
		await this.redisService.clearActiveRun(ctx.conversationId);
		await this.emitRunEvent(ctx, userId, "completed", "ended", "Plan rejected", {
			result: aiResponse,
		});
		await this.redisService.finalizeSnapshot(ctx.runId);
		return undefined;
	}

	// Load previous messages from DB using HarnessService
	public async loadMessages(
		conversationId: string,
		limit: number = 5,
	): Promise<BaseMessage[]> {
		const harnessService = new HarnessService(conversationId);
		return await harnessService.getConversationMessageHistory(limit);
	}

	private async buildState(
		ctx: HarnessRunContext,
		mode: "start" | "continue",
	): Promise<Partial<GlobalGraphState>> {
		const harnessService = new HarnessService(ctx.conversationId);
		const messages = await harnessService.getConversationMessageHistory();
		if (ctx.query) {
			messages.push(new HumanMessage(ctx.query));
		} else if (mode === "continue" && ctx.action) {
			const decision = describeHitlAction(ctx.action);
			if (decision) messages.push(new HumanMessage(decision));
		}

		// On resume, rehydrate the serializable working-memory slices persisted
		// when the run parked at HITL.
		const workingMemory =
			mode === "continue"
				? ((await harnessService.loadWorkingMemory(ctx.runId)) ?? {})
				: {};

		// Resolve the resource the user was viewing (if any) once, here, instead
		// of letting the planner burn a find_resource tool call rediscovering an
		// id the request already carried. One cheap DB hit, zero model tokens.
		const contextBlock = await buildContextBlock(
			this.dbService,
			ctx.metadata?.projectId,
			ctx.metadata?.location,
		);

		return {
			...workingMemory,
			messages,
			userQuery: ctx.query,
			action: ctx.action,
			internal: {
				dbService: this.dbService,
				harnessService,
				// runId/conversationId are surfaced here so nodes (e.g. Summarizer)
				// can persist artifacts without threading them through graph state.
				metadata: {
					...ctx.metadata,
					runId: ctx.runId,
					conversationId: ctx.conversationId,
					contextBlock,
				},
			},
			agentWrapper: this.agentFactory.createAgent(),
		};
	}

	private async executeGraph(
		ctx: HarnessRunContext,
		state: Partial<GlobalGraphState>,
	) {
		const harnessService = state.internal!.harnessService;
		// Resolve the conversation owner once — it's the `conversations.<userId>`
		// pub/sub subject every event for this run is published to.
		const userId = await harnessService.getOwnerUserId();

		// Bookend #1. Emitted before anything can fail (including the provider
		// probe below) so every run's event log opens the same way.
		await this.emitRunEvent(
			ctx,
			userId,
			"queued",
			"started",
			ctx.action ? "Resuming your request" : "Starting on your request",
		);

		// Verify the selected AI provider is actually reachable before spending a
		// run on it. On failure, exit with a meaningful aiResponse instead of a
		// cryptic mid-graph error.
		const connError = await this.checkAgentConnection(state.agentWrapper);
		if (connError) {
			await this.failRun(
				ctx,
				harnessService,
				userId,
				connError,
				`The selected AI provider could not be reached, so this request was not processed. Please verify the integration's API key, model, and network access.\n\nDetails: ${connError}`,
			);
			return undefined;
		}

		const callbacks = new this.callbacksClass({
			state,
			conversationId: ctx.conversationId,
			runId: ctx.runId,
			harnessService,
			redisService: this.redisService,
			userId,
		});

		// Per-run interrupt: the AbortController's signal cancels every model call;
		// aborting it raises UserInterruptError out of the graph (caught below).
		const abortController = new AbortController();
		state.agentWrapper?.setAbortSignal(abortController.signal);
		// Surfaces retryable model errors (bad structured output, transient
		// network issues) as live "warning" events instead of only finding out
		// when the run eventually finishes or fails.
		state.agentWrapper?.setRetryWarningSink((info) =>
			callbacks.emitRetryWarning(info),
		);
		registerRunController(ctx.conversationId, abortController);

		// Attach the OTEL tracer as a run callback (app.invoke used to pass this;
		// the streamEvents path must supply it explicitly for LLM/agent tracing).
		const streamConfig: any = {
			version: "v2",
			callbacks: [new FluxifyOtelTracer()],
			signal: abortController.signal,
			// Each task level costs 3 supersteps (sub-agent -> supervisor ->
			// orchestrator), so LangGraph's default of 25 fails a perfectly healthy
			// multi-task build right after it produced correct output.
			recursionLimit: 100,
		};
		let finalState: Partial<GlobalGraphState> | undefined;
		// Last node the graph entered — the one to blame if the run throws.
		let lastNode: AgentNodeName | undefined;

		try {
			await harnessService.updateRun(
				{ runId: ctx.runId, status: "routing" },
				true,
			);
			await harnessService.updateConversationStatus("running", ctx.runId);

			// A HITL `approve`/`review` resume enters the graph past the router (and
			// past verify, for `approve`) — see graph.ts's conditional START edge. The
			// WS client's first signal that the run is moving would otherwise be
			// whatever node it happens to land on, which is easy to lose (a single
			// event racing the client's resubscribe right after it submitted the
			// review). Emit an explicit status event for the actual entry node right
			// away so the UI can't miss the resume.
			if (state.action?.type === "approve" || state.action?.type === "review") {
				const entryNode =
					state.action.type === "approve"
						? AgentNode.TASK_GENERATOR
						: AgentNode.VERIFY_USER_QUERY;
				await this.emitRunEvent(
					ctx,
					userId,
					runStatusForNode(entryNode),
					"running",
					`Resuming at the ${labelForNode(entryNode)}`,
				);
			}

			await withFluxifyContext(
				{
					userQuery: state.userQuery,
					action: state.action ? JSON.stringify(state.action) : undefined,
				},
				async () => {
					const events = (await this.graph.streamEvents(
						state,
						streamConfig,
					)) as any;

					for await (const event of events) {
						if (event.event === "on_custom_event") {
							await callbacks.onCustomEvent(
								event.name as CustomEventName,
								event.data,
							);
						} else if (
							event.event === "on_chain_start" &&
							event.name !== "LangGraph"
						) {
							lastNode = event.name as AgentNodeName;
							await callbacks.onBefore(event.name as AgentNodeName, event.data);
						} else if (event.event === "on_chain_end") {
							if (event.name === "LangGraph") {
								finalState = event.data.output as Partial<GlobalGraphState>;
							} else {
								await callbacks.onAfter(
									event.name as AgentNodeName,
									event.data,
								);
							}
						}
					}
				},
			);

			await callbacks.flush();
			await this.finalizeRun(ctx, harnessService, userId, finalState);
		} catch (error) {
			await callbacks.flush().catch(() => {});

			// User interrupt is a clean terminal, not a failure — finalize as
			// `interrupted` and don't rethrow (so BullMQ doesn't retry the job).
			// A bare AbortError only means "interrupted" if this run's controller
			// actually fired — provider-side timeouts abort too, and those are
			// failures, not user stops.
			if (isUserInterrupt(error) && abortController.signal.aborted) {
				logger.info("[FluxifyHarness] Run interrupted by user", {
					conversationId: ctx.conversationId,
					runId: ctx.runId,
				});
				await this.interruptRun(ctx, harnessService, userId);
				return undefined;
			}

			logger.error("[FluxifyHarness] Graph execution failed", {
				conversationId: ctx.conversationId,
				runId: ctx.runId,
				error,
			});
			// Raw dump so the underlying stack is visible in foreground runs.
			logger.error("Graph error", "FluxifyHarness", { error });
			await this.failRun(
				ctx,
				harnessService,
				userId,
				error,
				describeFailure(error, lastNode),
				lastNode,
			);
			throw error;
		} finally {
			unregisterRunController(ctx.conversationId);
			await harnessService.awaitAllPendingBackgroundTasks();
		}

		return finalState;
	}

	/**
	 * Persists the terminal outcome of a run. A planner that halts for review
	 * parks the run in `awaiting_hitl` with the markdown plan stored as the run's
	 * `aiResponse` (the final result of the harness pass); anything else that
	 * reaches END completes.
	 */
	private async finalizeRun(
		ctx: HarnessRunContext,
		harnessService: HarnessService,
		userId: string | null,
		finalState?: Partial<GlobalGraphState>,
	) {
		const reachedHITL =
			finalState?.currentAgent === AgentNode.HUMAN_IN_THE_LOOP;

		if (reachedHITL) {
			const markdownPlan = finalState?.plannerState?.markdownPlan;
			await harnessService.updateRun({
				runId: ctx.runId,
				status: "awaiting_hitl",
				aiResponse: markdownPlan,
				interruptedAt: new Date(),
			});
			await harnessService.saveLiveState({
				runId: ctx.runId,
				conversationId: ctx.conversationId,
				currentState: "paused_hitl",
				graphState: finalState,
			});
			await harnessService.updateConversationStatus("paused_hitl", ctx.runId);
			await this.emitRunEvent(
				ctx,
				userId,
				"awaiting_hitl",
				"ended",
				"Paused — the plan is waiting for your review",
				{ result: markdownPlan },
			);
			// HITL is terminal for this run pass — evict its live-state snapshot soon.
			await this.redisService.finalizeSnapshot(ctx.runId);
			logger.info("[FluxifyHarness] Run parked for HITL", {
				runId: ctx.runId,
				conversationId: ctx.conversationId,
			});
			return;
		}

		const aiResponse =
			finalState?.summarizerState?.markdown ??
			finalState?.discussionState?.markdown ??
			finalState?.plannerState?.markdownPlan ??
			null;

		await harnessService.updateRun({
			runId: ctx.runId,
			status: "completed",
			aiResponse: aiResponse ?? undefined,
			completedAt: new Date(),
		});
		await harnessService.saveLiveState({
			runId: ctx.runId,
			conversationId: ctx.conversationId,
			currentState: "completed",
			graphState: finalState,
		});
		await harnessService.updateConversationStatus("completed", null);
		await this.redisService.clearActiveRun(ctx.conversationId);
		await this.emitRunEvent(ctx, userId, "completed", "ended", "All done", {
			result: aiResponse ?? undefined,
			artifactId: finalState?.summarizerState?.artifactId,
		});
		await this.redisService.finalizeSnapshot(ctx.runId);
	}

	/**
	 * Probes the AI provider once before running. Returns an error string if the
	 * provider is unreachable, or null when it responds.
	 */
	private async checkAgentConnection(
		agent?: BaseAgentWrapper,
	): Promise<string | null> {
		if (!agent) return "No AI agent configured for this run";
		try {
			await agent.checkConnection();
			return null;
		} catch (e) {
			return e instanceof Error ? e.message : String(e);
		}
	}

	private async failRun(
		ctx: HarnessRunContext,
		harnessService: HarnessService,
		userId: string | null,
		error?: unknown,
		aiResponse?: string,
		node?: AgentNodeName,
	) {
		const message =
			error instanceof Error ? error.message : error ? String(error) : "failed";
		try {
			await harnessService.updateRun({
				runId: ctx.runId,
				status: "failed",
				aiResponse,
			});
			await harnessService.saveLiveState({
				runId: ctx.runId,
				conversationId: ctx.conversationId,
				currentState: "failed",
				workingMemory: {},
			});
			await harnessService.updateConversationStatus("failed", null);
			await this.redisService.clearActiveRun(ctx.conversationId);
			await this.emitRunEvent(
				ctx,
				userId,
				"failed",
				"ended",
				`Failed at the ${labelForNode(node)}`,
				{ result: aiResponse, error: message },
			);
			await this.redisService.finalizeSnapshot(ctx.runId);
		} catch (e) {
			logger.error("[FluxifyHarness] Error persisting run failure", {
				runId: ctx.runId,
				error: e,
			});
		}
	}

	/**
	 * Requests interruption of a running conversation. Delivered to whichever
	 * worker is executing the run (over NATS); that worker aborts the run's
	 * AbortController, which raises UserInterruptError out of the graph and lands
	 * in `interruptRun`. Safe to call from any process.
	 */
	public interrupt(conversationId: string): void {
		requestInterrupt(conversationId);
	}

	/** Persists a user-interrupted run as `interrupted` with a meaningful response. */
	private async interruptRun(
		ctx: HarnessRunContext,
		harnessService: HarnessService,
		userId: string | null,
	) {
		const message =
			"Conversation was interrupted by the user before it finished.";
		try {
			await harnessService.updateRun({
				runId: ctx.runId,
				status: "interrupted",
				aiResponse: message,
				interruptedAt: new Date(),
			});
			await harnessService.saveLiveState({
				runId: ctx.runId,
				conversationId: ctx.conversationId,
				currentState: "interrupted",
				workingMemory: {},
			});
			await harnessService.updateConversationStatus("interrupted", null);
			await this.redisService.clearActiveRun(ctx.conversationId);
			await this.emitRunEvent(ctx, userId, "interrupted", "ended", message, {
				result: message,
			});
			await this.redisService.finalizeSnapshot(ctx.runId);
		} catch (e) {
			logger.error("[FluxifyHarness] Error persisting run interrupt", {
				runId: ctx.runId,
				error: e,
			});
		}
	}

	/**
	 * Emits a run-level bookend on the synthetic `run` node — the first and last
	 * event of every run, whatever happens in between. The `ended` one carries the
	 * full result (or the failure reason) so a client never has to re-fetch.
	 */
	private async emitRunEvent(
		ctx: HarnessRunContext,
		userId: string | null,
		runStatus: HarnessRunStatus,
		nodeStatus: HarnessNodeStatus,
		message: string,
		result?: Omit<HarnessRunResult, "runStatus">,
	) {
		const event: HarnessStreamEvent = {
			conversationId: ctx.conversationId,
			runId: ctx.runId,
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
			if (userId) publishHarnessEvent(userId, event);
		} catch (e) {
			logger.error("[FluxifyHarness] Error emitting terminal event", {
				runId: ctx.runId,
				error: e,
			});
		}
	}
}

export {
	AgentFactory,
	type AgentFactoryOptions,
	type AgentProvider,
	GraphState,
	type GlobalGraphState,
	BaseAgentWrapper,
	type AgentInvokeOptions,
	HarnessCallbacks,
	HarnessService,
	RedisService,
	type UpsertStepInput,
	type SaveLiveStateInput,
	type HitlPlanAction,
	type RecordHitlActionInput,
	extractWorkingMemory,
	type AgentNodeName,
	type CustomEventName,
};
