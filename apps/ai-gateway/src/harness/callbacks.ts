import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { logger } from "@fluxify/common";
import {
	AgentNode,
	type GlobalGraphState,
	type AgentNodeName,
	type CustomEventName,
	type AgentCustomEvent,
	type ToolCallEventData,
} from "./types";
import {
	type HarnessStreamEvent,
	type HarnessNodePayload,
	type HarnessNodeStatus,
	type HarnessExecutionType,
	type HarnessEventNode,
	type HarnessRunStatus,
	levelForNode,
	runStatusForNode,
	labelForNode,
	nodeIdFor,
	nodeMessage,
	toolMessage,
	buildTasksByLevel,
	activeLevelIndex,
} from "./streamTypes";
import type { HarnessService } from "./internal/harnessService";
import type { RedisService } from "./internal/redisService";
import { publishHarnessEvent } from "./notifications";
import { explainErrorReason } from "./errors";
import type { RetryWarningInfo } from "./models/base";

export async function dispatchAgentEvent(event: AgentCustomEvent): Promise<void> {
	await dispatchCustomEvent(event.name, event.data);
}

/** Valid graph-node names. `streamEvents` also emits chain events for nested
 *  LLM/tool runnables — those are filtered out so we only persist real nodes. */
const GRAPH_NODES: ReadonlySet<string> = new Set<string>(
	Object.values(AgentNode),
);

export interface HarnessCallbackContext {
	state: Partial<GlobalGraphState>;
	conversationId: string;
	runId: string;
	harnessService: HarnessService;
	redisService: RedisService;
	/** Conversation owner — the `conversations.<userId>` subject to publish to.
	 *  Null when the conversation has no owner (e.g. the local demo). */
	userId: string | null;
}

/**
 * Drives all harness persistence + streaming. Instantiated once per graph run;
 * `harness/index.ts` calls onBefore/onAfter/onCustomEvent as it iterates
 * `graph.streamEvents`. Each node execution:
 *  - upserts a step + saves live working-memory to Postgres (HarnessService)
 *  - caches a structured event to Redis (RedisService)
 *  - pushes the event through the BullMQ job (job.updateProgress) which the
 *    QueueEvents -> EventEmitter bridge fans out to SSE subscribers.
 */
export class HarnessCallbacks {
	protected state: Partial<GlobalGraphState>;
	private conversationId: string;
	private runId: string;
	private harnessService: HarnessService;
	private redisService: RedisService;
	private userId: string | null;
	/** Shallow-merged accumulation of node outputs for live-state snapshots. */
	private mergedState: Partial<GlobalGraphState>;
	/** Serialized, off-hot-path emit chain. Emitting must never block the
	 *  streamEvents consumer loop (which would back-pressure/stall the graph),
	 *  but events must still persist in order. Drained via flush(). */
	private emitChain: Promise<void> = Promise.resolve();

	constructor(ctx: HarnessCallbackContext) {
		this.state = ctx.state;
		this.conversationId = ctx.conversationId;
		this.runId = ctx.runId;
		this.harnessService = ctx.harnessService;
		this.redisService = ctx.redisService;
		this.userId = ctx.userId;
		this.mergedState = { ...ctx.state };
	}

	/* ---------------------------------------------------------------- helpers */

	/** Builds the one standard event shape. `nodeId` doubles as the DB
	 *  `subAgentId` key, so a node's step upsert stays idempotent across
	 *  re-executions and its events stay correlatable client-side. */
	private makeEvent(opts: {
		node: HarnessEventNode;
		nodeStatus: HarnessNodeStatus;
		message: string;
		taskId?: string;
		executionType?: HarnessExecutionType;
		toolName?: string;
		payload?: HarnessNodePayload;
		runStatus?: HarnessRunStatus;
	}): HarnessStreamEvent {
		return {
			conversationId: this.conversationId,
			runId: this.runId,
			currentNode: opts.node,
			nodeId: nodeIdFor(opts.node, opts.taskId),
			nodeStatus: opts.nodeStatus,
			executionType: opts.executionType ?? "agent",
			toolName: opts.toolName,
			plainTextMessage: opts.message,
			runStatus: opts.runStatus ?? runStatusForNode(opts.node),
			level: levelForNode(opts.node),
			payload: opts.payload,
			timestamp: Date.now(),
		};
	}

	/** Non-blocking: schedules the event on the serialized emit chain and returns
	 *  immediately so the graph is never gated on Redis / NATS. */
	private emit(event: HarnessStreamEvent): void {
		this.emitChain = this.emitChain.then(async () => {
			try {
				await this.redisService.appendEvent(event);
				if (this.userId) publishHarnessEvent(this.userId, event);
			} catch (error) {
				logger.error("Error emitting event", "HarnessCallbacks", {
					runId: this.runId,
					node: event.currentNode,
					error,
				});
			}
		});
	}

	/** Awaits all scheduled emits. Called by the harness before finalizing. */
	public async flush(): Promise<void> {
		await this.emitChain;
	}

	/** Builds the node-typed payload from the node's returned output slice. */
	private buildPayload(
		node: AgentNodeName,
		output: Partial<GlobalGraphState>,
		input: Partial<GlobalGraphState>,
	): HarnessNodePayload | undefined {
		switch (node) {
			case AgentNode.ROUTER:
				return { node: AgentNode.ROUTER, data: output.routerState ?? {} };
			case AgentNode.VERIFY_USER_QUERY:
				return {
					node: AgentNode.VERIFY_USER_QUERY,
					data: output.verifyUserQueryState ?? {},
				};
			case AgentNode.PLANNER:
				return { node: AgentNode.PLANNER, data: output.plannerState ?? {} };
			case AgentNode.DISCUSSION:
				return {
					node: AgentNode.DISCUSSION,
					data: output.discussionState ?? {},
				};
			case AgentNode.TASK_GENERATOR: {
				const tasksByLevel = buildTasksByLevel(output.orchestratorState?.tasks);
				return { node: AgentNode.TASK_GENERATOR, data: { tasksByLevel } };
			}
			case AgentNode.ORCHESTRATOR: {
				const tasksByLevel = buildTasksByLevel(output.orchestratorState?.tasks);
				return {
					node: AgentNode.ORCHESTRATOR,
					data: { tasksByLevel, activeLevel: activeLevelIndex(tasksByLevel) },
				};
			}
			case AgentNode.SUPERVISOR: {
				const tasksByLevel = buildTasksByLevel(output.orchestratorState?.tasks);
				return { node: AgentNode.SUPERVISOR, data: { tasksByLevel } };
			}
			case AgentNode.SUMMARIZER:
				return { node: AgentNode.SUMMARIZER, data: output.summarizerState ?? {} };
			case AgentNode.BLOCK_BUILDER:
			case AgentNode.ROUTE_CONFIG_AGENT: {
				const task = output.activeTask ?? input.activeTask;
				if (!task) return undefined;
				const result = output.orchestratorState?.subAgentResults?.[task.id];
				return {
					node: node as AgentNode.BLOCK_BUILDER | AgentNode.ROUTE_CONFIG_AGENT,
					data: {
						task: {
							id: task.id,
							title: task.title,
							status: task.status,
							assignedAgentNode: task.assignedAgentNode,
							level: 0,
						},
						result,
					},
				};
			}
			default:
				return undefined;
		}
	}

	/* ------------------------------------------------------- lifecycle hooks */

	public async onBefore(node: AgentNodeName, eventData: any): Promise<void> {
		if (!GRAPH_NODES.has(node)) return;
		const input = (eventData?.input ?? {}) as Partial<GlobalGraphState>;
		const taskId = input.activeTask?.id;

		const step = await this.harnessService.upsertStep(
			{
				runId: this.runId,
				conversationId: this.conversationId,
				stepType: node,
				subAgentRole: node,
				subAgentId: nodeIdFor(node, taskId),
				status: "running",
			},
			true, // background
		);

		await this.harnessService.saveLiveState(
			{
				runId: this.runId,
				conversationId: this.conversationId,
				currentState: "running",
				activeStepId: step?.id,
				graphState: this.mergedState,
			},
			true,
		);

		this.emit(
			this.makeEvent({
				node,
				taskId,
				nodeStatus: "started",
				message: nodeMessage(node, "started"),
			}),
		);
	}

	public async onAfter(node: AgentNodeName, eventData: any): Promise<void> {
		if (!GRAPH_NODES.has(node)) return;
		const output = (eventData?.output ?? {}) as Partial<GlobalGraphState>;
		const input = (eventData?.input ?? {}) as Partial<GlobalGraphState>;
		this.mergedState = { ...this.mergedState, ...output };

		const taskId = output.activeTask?.id ?? input.activeTask?.id;

		await this.harnessService.upsertStep(
			{
				runId: this.runId,
				conversationId: this.conversationId,
				stepType: node,
				subAgentRole: node,
				subAgentId: nodeIdFor(node, taskId),
				status: "completed",
			},
			true,
		);

		await this.harnessService.saveLiveState(
			{
				runId: this.runId,
				conversationId: this.conversationId,
				currentState: "running",
				graphState: this.mergedState,
			},
			true,
		);

		const payload = this.buildPayload(node, output, input);
		this.emit(
			this.makeEvent({
				node,
				taskId,
				nodeStatus: "ended",
				message: nodeMessage(node, "ended"),
				payload,
			}),
		);
	}

	public async onCustomEvent(
		eventName: CustomEventName,
		eventData: any,
	): Promise<void> {
		if (eventName === "agent_status") {
			const node = (eventData?.agent ?? AgentNode.ROUTER) as AgentNodeName;
			if (!GRAPH_NODES.has(node)) return;
			this.emit(
				this.makeEvent({
					node,
					taskId: eventData?.agentId,
					nodeStatus: "running",
					message: eventData?.status ?? `Working on ${labelForNode(node)}`,
				}),
			);
			return;
		}

		if (eventName === "tool_call") {
			const data = eventData as ToolCallEventData;
			const node = data?.agent as AgentNodeName;
			if (!GRAPH_NODES.has(node) || !data?.tool) return;
			this.emit(
				this.makeEvent({
					node,
					taskId: data.agentId,
					// A tool call is its own started/ended pair nested inside the node's
					// own pair — same nodeId, so the client can attach it to the row.
					nodeStatus: data.status,
					executionType: "tool",
					toolName: data.tool,
					message: toolMessage(data.tool, data.status, data.summary, data.error),
				}),
			);
			return;
		}

		if (eventName === "human_in_the_loop_required") {
			const node = AgentNode.HUMAN_IN_THE_LOOP;
			const markdownPlan =
				eventData?.data?.markdownPlan ?? this.mergedState.plannerState?.markdownPlan;
			this.emit(
				this.makeEvent({
					node,
					nodeStatus: "running",
					message: "Waiting for you to review the plan",
					payload: {
						node,
						data: { reason: eventData?.reason ?? "review", markdownPlan },
					},
				}),
			);
		}
	}

	/** A model call inside an agent hit a retryable error (bad structured
	 *  output, transient network blip) and is re-asking rather than failing the
	 *  run outright. Surfaced live so the UI doesn't just look stuck — wired in
	 *  from `BaseAgentWrapper.setRetryWarningSink` in `FluxifyHarness.executeGraph`. */
	public emitRetryWarning(info: RetryWarningInfo): void {
		const node = (info.agentNode as AgentNodeName) ?? AgentNode.ROUTER;
		if (!GRAPH_NODES.has(node)) return;
		const reason = explainErrorReason(info.rawError);
		this.emit(
			this.makeEvent({
				node,
				nodeStatus: "running",
				message: `The ${labelForNode(node)} hit a hiccup and is retrying (attempt ${info.attempt}/${info.maxAttempts}) — ${reason}`,
			}),
		);
	}
}
