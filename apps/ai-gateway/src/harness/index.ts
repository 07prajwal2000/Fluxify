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
import { RunBudget } from "./models/budget";
import { app as graphApp } from "./graph";
import { DbService } from "./internal/dbService";
import {
	buildContextBlock,
	locationFromResourceChips,
} from "./internal/contextBlock";
import { sanitizeUserQuery } from "./internal/untrusted";
import type { HarnessRunContext } from "./internal/runContext";
import { RunOutcomeWriter } from "./internal/runOutcome";
import {
	describeHitlAction,
	extractWorkingMemory,
	HarnessService,
	HitlPlanAction,
	RecordHitlActionInput,
	SaveLiveStateInput,
	UpsertStepInput,
} from "./internal/harnessService";
import { RedisService } from "./internal/redisService";
import { FluxifyOtelTracer } from "./telemetry/otel-tracer";
import {
	startRunSpan,
	withRunSpan,
	recordRetryOnRunSpan,
	endRunSpan,
} from "./telemetry/runSpan";
import { HarnessCallbacks } from "./callbacks";
import {
	labelForNode,
	runStatusForNode,
	type HarnessRunStatus,
} from "./streamTypes";
import { isUserInterrupt, describeFailure, redactSecrets } from "./errors";
import {
	registerRunController,
	unregisterRunController,
	requestInterrupt,
} from "./interrupt";

/** Everything a single harness run needs — supplied by the worker from job data. */
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
			const harnessService = new HarnessService(ctx.conversationId);
			await (await this.outcomeWriter(ctx, harnessService)).reject(ctx.action);
			return undefined;
		}
		const state = await this.buildState(ctx, "continue");
		return await this.executeGraph(ctx, state);
	}

	/** Resolves the conversation owner — the `conversations.<userId>` subject
	 *  every event for this run is published to — and binds it to the run. */
	private async outcomeWriter(
		ctx: HarnessRunContext,
		harnessService: HarnessService,
	): Promise<RunOutcomeWriter> {
		return new RunOutcomeWriter(
			ctx,
			harnessService,
			await harnessService.getOwnerUserId(),
			this.redisService,
			this.agentFactory,
		);
	}

	// Load previous messages from DB using HarnessService
	public async loadMessages(conversationId: string): Promise<BaseMessage[]> {
		const harnessService = new HarnessService(conversationId);
		return await harnessService.getConversationMessageHistory();
	}

	private async buildState(
		ctx: HarnessRunContext,
		mode: "start" | "continue",
	): Promise<Partial<GlobalGraphState>> {
		const harnessService = new HarnessService(ctx.conversationId);
		const messages = await harnessService.getConversationMessageHistory();
		const historyMessageCount = messages.length;
		// The composer sends @-mentions as raw `:resource{...}` markup. Nothing
		// downstream parsed it, so agents saw markup, guessed a keyword, and told
		// the user their own resource did not exist. Rewriting it here also keeps
		// hand-typed chip syntax from reaching the model. The stored message keeps
		// the markup — that is what renders the chip back to the user.
		const query = ctx.query ? sanitizeUserQuery(ctx.query) : ctx.query;
		if (query) {
			messages.push(new HumanMessage(query));
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

		// Resolve the resource the user was viewing — or, failing that, the one
		// they @-mentioned — once, here, instead of letting an agent burn a
		// find_resource call rediscovering an id the request already carried.
		// It goes back onto the metadata so sub-agent target resolution agrees
		// with it and skips re-rendering the canvas (`buildTargetCanvasContext`).
		const location = locationFromResourceChips(ctx.query, ctx.metadata?.location);
		const [contextBlock, projectInventory] = await Promise.all([
			buildContextBlock(this.dbService, ctx.metadata?.projectId, location),
			// A HITL continuation already has the approved plan. Avoid loading a
			// generic catalogue unless this pass has a fresh user request to match.
			this.dbService.getProjectInventory(ctx.metadata?.projectId, query),
		]);

		return {
			...workingMemory,
			messages,
			historyMessageCount,
			userQuery: query,
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
					location,
					contextBlock,
					projectInventory,
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
		const runOutcome = await this.outcomeWriter(ctx, harnessService);

		// Bookend #1. Emitted before anything can fail (including the provider
		// probe below) so every run's event log opens the same way.
		await runOutcome.emit(
			"queued",
			"started",
			ctx.action ? "Resuming your request" : "Starting on your request",
		);

		// Verify the selected AI provider is actually reachable before spending a
		// run on it. On failure, exit with a meaningful aiResponse instead of a
		// cryptic mid-graph error.
		const connError = await this.checkAgentConnection(state.agentWrapper);
		if (connError) {
			await runOutcome.fail(
				connError,
				`The selected AI provider could not be reached, so this request was not processed. Please verify the integration's API key, model, and network access.\n\nDetails: ${redactSecrets(connError)}`,
			);
			return undefined;
		}

		// Per-run deadline + token ceiling and usage accounting. The clock starts
		// before callbacks so every live stats snapshot has the same origin.
		const budget = new RunBudget();

		const callbacks = new this.callbacksClass({
			state,
			conversationId: ctx.conversationId,
			runId: ctx.runId,
			harnessService,
			redisService: this.redisService,
			userId: runOutcome.userId,
			budget,
		});

		// Per-run interrupt: the AbortController's signal cancels every model call;
		// aborting it raises UserInterruptError out of the graph (caught below).
		const abortController = new AbortController();
		state.agentWrapper?.setAbortSignal(abortController.signal);
		state.agentWrapper?.setRunBudget(budget);
		// Covers the whole run — the tracer's own spans all end mid-stream, so the
		// run's cost and outcome have nowhere else to live.
		const runSpan = startRunSpan({
			runId: ctx.runId,
			conversationId: ctx.conversationId,
			projectId: ctx.metadata?.projectId,
			userQuery: ctx.query,
		});
		// Surfaces retryable model errors (bad structured output, transient
		// network issues) as live "warning" events instead of only finding out
		// when the run eventually finishes or fails.
		state.agentWrapper?.setRetryWarningSink((info) => {
			budget.recordRetry(info.agentNode);
			recordRetryOnRunSpan(runSpan, info);
			callbacks.emitRetryWarning(info);
		});
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
		// How the run ended, for the trace. Set on every exit path below.
		let outcome: { status: HarnessRunStatus; error?: unknown } = {
			status: "completed",
		};

		try {
			await harnessService.updateRun(
				{ runId: ctx.runId, status: "routing" },
				true,
			);
			await harnessService.updateConversationStatus("running", ctx.runId);

			// An `approve` resume enters the graph past the router — see graph.ts's
			// conditional START edge. The WS client's first signal that the run is
			// moving would otherwise be whatever node it happens to land on, which is
			// easy to lose (a single event racing the client's resubscribe right after
			// it submitted the review). Emit an explicit status event for the actual
			// entry node right away so the UI can't miss the resume.
			if (state.action?.type === "approve" || state.action?.type === "review") {
				const entryNode =
					state.action.type === "approve"
						? AgentNode.TASK_GENERATOR
						: AgentNode.ROUTER;
				await runOutcome.emit(
					runStatusForNode(entryNode),
					"running",
					`Resuming at the ${labelForNode(entryNode)}`,
				);
			}

			// The run span wraps the context, not the other way round: everything
			// the graph traces from here on nests under this one run.
			finalState = await withRunSpan(runSpan, () =>
				withFluxifyContext(
					{
						userQuery: state.userQuery,
						action: state.action ? JSON.stringify(state.action) : undefined,
					},
					() =>
						this.streamGraph(state, streamConfig, callbacks, (node) => {
							lastNode = node;
						}),
				),
			);

			await callbacks.flush();
			// The graph is already done here. `finalizeRun` is bookkeeping, and a DB
			// blip inside it must not fall into the catch below and re-brand a
			// finished run as failed — the user's build landed either way.
			try {
				await runOutcome.finalize(
					budget,
					callbacks.toolCallCount(),
					finalState,
				);
			} catch (error) {
				logger.error("[FluxifyHarness] Failed to finalize a completed run", {
					conversationId: ctx.conversationId,
					runId: ctx.runId,
					error,
				});
			}
		} catch (error) {
			await callbacks.flush().catch(() => {});

			// User interrupt is a clean terminal, not a failure — finalize as
			// `interrupted` and don't rethrow (nothing to retry; the job is already acked).
			// A bare AbortError only means "interrupted" if this run's controller
			// actually fired — provider-side timeouts abort too, and those are
			// failures, not user stops.
			if (isUserInterrupt(error) && abortController.signal.aborted) {
				outcome = { status: "interrupted" };
				logger.info("[FluxifyHarness] Run interrupted by user", {
					conversationId: ctx.conversationId,
					runId: ctx.runId,
				});
				await runOutcome.interrupt(
					budget,
					callbacks.toolCallCount(),
					callbacks.snapshotState(),
				);
				return undefined;
			}

			outcome = { status: "failed", error };
			logger.error("[FluxifyHarness] Graph execution failed", {
				conversationId: ctx.conversationId,
				runId: ctx.runId,
				error,
			});
			// Raw dump so the underlying stack is visible in foreground runs.
			logger.error("Graph error", "FluxifyHarness", { error });
			await runOutcome.fail(
				error,
				describeFailure(error, lastNode),
				lastNode,
				budget,
				callbacks.toolCallCount(),
				callbacks.snapshotState(),
			);
			throw error;
		} finally {
			unregisterRunController(ctx.conversationId);
			endRunSpan(runSpan, {
				usage: budget.snapshot(),
				status: outcome.status,
				error: outcome.error,
				failedNode: outcome.error ? lastNode : undefined,
			});
			await harnessService.awaitAllPendingBackgroundTasks();
		}

		return finalState;
	}

	/**
	 * Drives the graph and hands every event to the run's callbacks. Returns the
	 * final graph state; `onNodeEnter` reports each node as it is entered, which
	 * is how the caller knows who to blame if the run throws.
	 */
	private async streamGraph(
		state: Partial<GlobalGraphState>,
		streamConfig: any,
		callbacks: HarnessCallbacks,
		onNodeEnter: (node: AgentNodeName) => void,
	): Promise<Partial<GlobalGraphState> | undefined> {
		let finalState: Partial<GlobalGraphState> | undefined;
		const events = (await this.graph.streamEvents(state, streamConfig)) as any;

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
				onNodeEnter(event.name as AgentNodeName);
				await callbacks.onBefore(event.name as AgentNodeName, event.data);
			} else if (event.event === "on_chain_end") {
				if (event.name === "LangGraph") {
					finalState = event.data.output as Partial<GlobalGraphState>;
				} else {
					await callbacks.onAfter(event.name as AgentNodeName, event.data);
				}
			}
		}

		return finalState;
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

	/**
	 * Requests interruption of a running conversation. Delivered to whichever
	 * worker is executing the run (over NATS); that worker aborts the run's
	 * AbortController, which raises UserInterruptError out of the graph and lands
	 * in `interruptRun`. Safe to call from any process.
	 */
	public interrupt(conversationId: string): void {
		requestInterrupt(conversationId);
	}
}

export {
	// Re-exported from ./errors, where it lives with the categorization it uses.
	describeFailure,
	type HarnessRunContext,
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
