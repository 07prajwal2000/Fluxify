import type { Job } from "bullmq";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { logger } from "@fluxify/common";
import {
	AgentNode,
	type GlobalGraphState,
	type AgentNodeName,
	type CustomEventName,
	type AgentCustomEvent,
} from "./types";
import {
	type HarnessStreamEvent,
	type HarnessNodePayload,
	type HarnessPhase,
	levelForNode,
	runStatusForNode,
	buildTasksByLevel,
	activeLevelIndex,
} from "./streamTypes";
import type { HarnessService } from "./internal/harnessService";
import type { RedisService } from "./internal/redisService";
import type { HarnessJobData } from "./queue";

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
	job?: Job<HarnessJobData>;
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
	private job?: Job<HarnessJobData>;
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
		this.job = ctx.job;
		this.mergedState = { ...ctx.state };
	}

	/* ---------------------------------------------------------------- helpers */

	/** subAgentId key: stable per node (and per task for sub-agents) so the
	 *  step upsert is idempotent across re-executions / dispatch levels. */
	private stepKey(node: AgentNodeName, taskId?: string): string {
		return taskId ? `${node}:${taskId}` : node;
	}

	private makeEvent(
		node: AgentNodeName,
		phase: HarnessPhase,
		status: string,
		payload?: HarnessNodePayload,
		stepId?: string,
	): HarnessStreamEvent {
		return {
			conversationId: this.conversationId,
			runId: this.runId,
			stepId,
			level: levelForNode(node),
			phase,
			node,
			status,
			runStatus: runStatusForNode(node),
			payload,
			timestamp: Date.now(),
		};
	}

	/** Non-blocking: schedules the event on the serialized emit chain and returns
	 *  immediately so the graph is never gated on Redis / BullMQ. */
	private emit(event: HarnessStreamEvent): void {
		this.emitChain = this.emitChain.then(async () => {
			try {
				await this.redisService.appendEvent(event);
				await this.job?.updateProgress(event as any);
			} catch (error) {
				logger.error("[HarnessCallbacks] Error emitting event", {
					runId: this.runId,
					node: event.node,
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
			case AgentNode.BUILDER:
			case AgentNode.ROUTE_CONFIG_AGENT: {
				const task = output.activeTask ?? input.activeTask;
				if (!task) return undefined;
				const result = output.orchestratorState?.subAgentResults?.[task.id];
				return {
					node: node as AgentNode.BUILDER | AgentNode.ROUTE_CONFIG_AGENT,
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
				subAgentId: this.stepKey(node, taskId),
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
			this.makeEvent(node, "node_start", `Running ${node}`, undefined, step?.id),
		);
	}

	public async onAfter(node: AgentNodeName, eventData: any): Promise<void> {
		if (!GRAPH_NODES.has(node)) return;
		const output = (eventData?.output ?? {}) as Partial<GlobalGraphState>;
		const input = (eventData?.input ?? {}) as Partial<GlobalGraphState>;
		this.mergedState = { ...this.mergedState, ...output };

		const taskId = output.activeTask?.id ?? input.activeTask?.id;

		const step = await this.harnessService.upsertStep(
			{
				runId: this.runId,
				conversationId: this.conversationId,
				stepType: node,
				subAgentRole: node,
				subAgentId: this.stepKey(node, taskId),
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
			this.makeEvent(node, "node_end", `Completed ${node}`, payload, step?.id),
		);
	}

	public async onCustomEvent(
		eventName: CustomEventName,
		eventData: any,
	): Promise<void> {
		if (eventName === "agent_status") {
			const node = (eventData?.agent ?? AgentNode.ROUTER) as AgentNodeName;
			this.emit(
				this.makeEvent(node, "status", eventData?.status ?? "working"),
			);
			return;
		}

		if (eventName === "human_in_the_loop_required") {
			const node = AgentNode.HUMAN_IN_THE_LOOP;
			const markdownPlan =
				eventData?.data?.markdownPlan ?? this.mergedState.plannerState?.markdownPlan;
			this.emit(
				this.makeEvent(node, "hitl_required", "Human review required", {
					node,
					data: { reason: eventData?.reason ?? "review", markdownPlan },
				}),
			);
		}
	}
}
