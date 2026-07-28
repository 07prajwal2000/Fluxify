import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import type { BaseAgentWrapper } from "./models/base";
import type { DbService } from "./internal/dbService";
import type { HarnessService, HitlPlanAction } from "./internal/harnessService";

export enum AgentNode {
	ROUTER = "router",
	CLASSIFIER = "classifier",
	VERIFY_USER_QUERY = "verifyUserQuery",
	PLANNER = "planner",
	TASK_GENERATOR = "taskGenerator",
	DISCUSSION = "discussion",
	BLOCK_BUILDER = "blockBuilder",
	ORCHESTRATOR = "orchestrator",
	HUMAN_IN_THE_LOOP = "humanInTheLoop",
	ROUTE_CONFIG_AGENT = "routeConfig",
	SUPERVISOR = "supervisor",
	SUMMARIZER = "summarizer",
}

export type ResourceType =
	| "route"
	| "app_config"
	| "integration"
	| "custom_block"
	| "route_canvas"
	| "custom_block_canvas";

export interface FindResourceResult {
	type: ResourceType;
	id: string;
	name: string;
	description?: string;
	path?: string;
	method?: string;
	group?: string;
	variant?: string;
}

export type AgentNodeName = `${AgentNode}`;

export type CustomEventName =
	| "agent_status"
	| "human_in_the_loop_required"
	| "tool_call";

/** Emitted by the tool-execution loop in `models/base.ts` around every tool
 *  invocation, so the client sees tool work as first-class progress instead of
 *  a silent gap inside an agent. */
export interface ToolCallEventData {
	/** Graph node whose agent requested the tool. */
	agent: string;
	/** Task id when a sub-agent requested it — becomes the event's `nodeId`. */
	agentId?: string;
	tool: string;
	status: "started" | "ended";
	/** Short description of what came back, e.g. "3 results". */
	summary?: string;
	error?: string;
}

export type AgentCustomEvent =
	| {
			name: "agent_status";
			data: { status: string; agent: AgentNode; data?: any; agentId?: string };
	  }
	| {
			name: "human_in_the_loop_required";
			data: { agent: string; reason: string; data?: any };
	  }
	| { name: "tool_call"; data: ToolCallEventData };

export interface Task {
	id: string;
	title: string;
	description: string;
	dependsOnAgentId: string[];
	status: "pending" | "running" | "completed" | "failed";
	assignedAgentNode: AgentNodeName;
	supervisorReviews?: string;
}

export interface RouterState {
	intent?: "discussion" | "builder";
	reason?: string;
}

export interface ClassifierState {
	status?: boolean;
	reasoning?: string;
	data?: "discussion" | "builder";
}

export interface VerifyUserQueryState {
	capable?: boolean;
	rejectReason?: string;
}

export interface BuilderState {
	agentA?: Record<string, unknown>;
	// Additional builder sub-agents state can be added here
}

export interface PlannerState {
	markdownPlan?: string;
	scratchpadNote?: string;
	confidenceScore?: number;
	implementationComplexity?: "high" | "mid" | "low";
}

export interface DiscussionState {
	markdown?: string;
}

export interface SummarizerState {
	/** Human-readable summary markdown with embedded special syntax tokens. */
	markdown?: string;
	/** The parent artifact row this summary was persisted to. */
	artifactId?: string;
}

export interface RouteConfigAgentResult {
	action: "create" | "delete" | "update-partial";
	routeId?: string;
	data?: {
		method?: string;
		path?: string;
		bodySchema?: any;
		paramsSchema?: any;
		querySchema?: any;
	};
}

export interface BlockBuilderAgentResult {
	reasoning: string;
	status: "success" | "impossible";
	targetType?: "route" | "custom_block";
	targetId?: string;
	canvasChanges: Record<string, unknown>[];
	blocks: Record<string, unknown>[];
}

export type SubAgentResult =
	| RouteConfigAgentResult
	| BlockBuilderAgentResult
	| Record<string, any>;

/**
 * Validator function for sub-agent outputs.
 *
 * @param result - The result outputted by the sub-agent.
 * @param taskId - The ID of the task that was executed.
 * @param state - The global graph state.
 * @returns null if valid, or a string describing the error if invalid.
 */
export type AgentOutputValidator = (
	result: SubAgentResult,
	taskId: string,
	state: GlobalGraphState,
) => Promise<string | null> | string | null;

export interface OrchestratorState {
	tasks?: Task[];
	/** Topologically sorted task IDs grouped by level, produced by the task
	 *  generator. Informational only — the orchestrator derives the next level
	 *  from task statuses + dependencies so re-entry can't skip or repeat one. */
	taskQueue?: string[][];
	dispatchedTasks?: Task[]; // Tasks dispatched in the current tick
	subAgentResults?: Record<string, SubAgentResult>;
}

export const GraphState = Annotation.Root({
	...MessagesAnnotation.spec,
	scratchpad: Annotation<string[]>({
		reducer: (oldState, newState) => [...oldState, ...newState],
		default: () => [],
	}),
	agentWrapper: Annotation<BaseAgentWrapper>({
		reducer: (oldState, newState) => newState ?? oldState,
		default: () => undefined as unknown as BaseAgentWrapper,
	}),
	internal: Annotation<{
		dbService: DbService;
		harnessService: HarnessService;
		metadata?: any;
	}>({
		reducer: (oldState, newState) => newState ?? oldState,
	}),
	userQuery: Annotation<string | undefined>({
		reducer: (oldState, newState) => newState ?? oldState,
		default: () => undefined,
	}),
	action: Annotation<HitlPlanAction | undefined>({
		reducer: (oldState, newState) => newState ?? oldState,
		default: () => undefined,
	}),
	nextRoute: Annotation<AgentNodeName | AgentNodeName[] | undefined>({
		reducer: (oldState, newState) =>
			newState !== undefined ? newState : oldState,
		default: () => undefined,
	}),
	activeTask: Annotation<Task | undefined>({
		reducer: (oldState, newState) => newState ?? oldState,
		default: () => undefined,
	}),
	currentAgent: Annotation<AgentNodeName | undefined>({
		reducer: (oldState, newState) => newState ?? oldState,
		default: () => undefined,
	}),
	routerState: Annotation<RouterState>({
		reducer: (oldState, newState) => ({ ...oldState, ...newState }),
		default: () => ({}),
	}),
	discussionState: Annotation<DiscussionState>({
		reducer: (oldState, newState) => ({ ...oldState, ...newState }),
		default: () => ({}),
	}),
	classifierState: Annotation<ClassifierState>({
		reducer: (oldState, newState) => ({ ...oldState, ...newState }),
		default: () => ({}),
	}),
	verifyUserQueryState: Annotation<VerifyUserQueryState>({
		reducer: (oldState, newState) => ({ ...oldState, ...newState }),
		default: () => ({}),
	}),
	builderState: Annotation<BuilderState>({
		reducer: (oldState, newState) => ({ ...oldState, ...newState }),
		default: () => ({}),
	}),
	plannerState: Annotation<PlannerState>({
		reducer: (oldState, newState) => ({ ...oldState, ...newState }),
		default: () => ({}),
	}),
	orchestratorState: Annotation<OrchestratorState>({
		reducer: (oldState, newState) => ({ ...oldState, ...newState }),
		default: () => ({}),
	}),
	summarizerState: Annotation<SummarizerState>({
		reducer: (oldState, newState) => ({ ...oldState, ...newState }),
		default: () => ({}),
	}),
	// Additional context can be added here in the future
});

export type GlobalGraphState = typeof GraphState.State;

export interface WorkflowMetadata {
	// combination of userId + projectId + location + routeId
	conversationId: string;
	userId: string;
	projectId: string;
	location: string;
	routeId: string;
	messageHistory: { role: string; content: string }[];
}
