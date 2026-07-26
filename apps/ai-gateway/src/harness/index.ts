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
	levelForNode,
	type HarnessRunStatus,
	type HarnessStreamEvent,
} from "./streamTypes";
import { publishHarnessEvent } from "./notifications";
import type { HarnessJobData, HarnessJobMetadata } from "./queue";

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
		const state = await this.buildState(ctx, "continue");
		return await this.executeGraph(ctx, state);
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
		}

		// On resume, rehydrate the serializable working-memory slices persisted
		// when the run parked at HITL.
		const workingMemory =
			mode === "continue"
				? (await harnessService.loadWorkingMemory(ctx.runId)) ?? {}
				: {};

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
		// Attach the OTEL tracer as a run callback (app.invoke used to pass this;
		// the streamEvents path must supply it explicitly for LLM/agent tracing).
		const streamConfig: any = {
			version: "v2",
			callbacks: [new FluxifyOtelTracer()],
		};
		let finalState: Partial<GlobalGraphState> | undefined;

		try {
			await harnessService.updateRun({ runId: ctx.runId, status: "routing" }, true);

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
							await callbacks.onBefore(event.name as AgentNodeName, event.data);
						} else if (event.event === "on_chain_end") {
							if (event.name === "LangGraph") {
								finalState = event.data.output as Partial<GlobalGraphState>;
							} else {
								await callbacks.onAfter(event.name as AgentNodeName, event.data);
							}
						}
					}
				},
			);

			await callbacks.flush();
			await this.finalizeRun(ctx, harnessService, userId, finalState);
		} catch (error) {
			logger.error("[FluxifyHarness] Graph execution failed", {
				conversationId: ctx.conversationId,
				runId: ctx.runId,
				error,
			});
			// Raw dump so the underlying stack is visible in foreground runs.
			logger.error("Graph error", "FluxifyHarness", { error });
			await callbacks.flush().catch(() => {});
			await this.failRun(ctx, harnessService, userId, error);
			throw error;
		} finally {
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
			await this.emitTerminal(ctx, userId, "awaiting_hitl", AgentNode.HUMAN_IN_THE_LOOP);
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
		await this.emitTerminal(
			ctx,
			userId,
			"completed",
			finalState?.currentAgent ?? AgentNode.ORCHESTRATOR,
		);
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
			await this.emitTerminal(ctx, userId, "failed", AgentNode.ROUTER, message);
			await this.redisService.finalizeSnapshot(ctx.runId);
		} catch (e) {
			logger.error("[FluxifyHarness] Error persisting run failure", {
				runId: ctx.runId,
				error: e,
			});
		}
	}

	/** Emits a run-level terminal event so subscribers get a close signal. */
	private async emitTerminal(
		ctx: HarnessRunContext,
		userId: string | null,
		runStatus: HarnessRunStatus,
		node: AgentNodeName,
		statusText?: string,
	) {
		const event: HarnessStreamEvent = {
			conversationId: ctx.conversationId,
			runId: ctx.runId,
			level: levelForNode(node),
			phase: "status",
			node,
			status: statusText ?? runStatus,
			runStatus,
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
