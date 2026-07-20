import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import type { BaseAgentWrapper } from "./models/base";
import type { DbService } from "./internal/dbService";

export enum AgentNode {
	ROUTER = "router",
	CLASSIFIER = "classifier",
	VERIFY_USER_QUERY = "verifyUserQuery",
	PLANNER = "planner",
	TASK_GENERATOR = "taskGenerator",
	DISCUSSION = "discussion",
	BUILDER = "builder",
	ORCHESTRATOR = "orchestrator",
	HUMAN_IN_THE_LOOP = "humanInTheLoop",
	ROUTE_CONFIG_AGENT = "routeConfig",
	SUPERVISOR = "supervisor",
}

export type AgentNodeName = `${AgentNode}`;

export type CustomEventName = "agent_status" | "human_in_the_loop_required";

export type AgentCustomEvent =
	| {
			name: "agent_status";
			data: { status: string; agent: AgentNode; data?: any };
	  }
	| {
			name: "human_in_the_loop_required";
			data: { agent: string; reason: string; data?: any };
	  };

export interface Task {
	id: string;
	title: string;
	description: string;
	dependsOnAgentId: string[];
	status: "pending" | "running" | "completed" | "failed";
	assignedAgentNode: AgentNodeName;
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
export type SubAgentResult = RouteConfigAgentResult | Record<string, any>;

/**
 * Validator function for sub-agent outputs.
 * 
 * @param result - The result outputted by the sub-agent.
 * @param taskId - The ID of the task that was executed.
 * @param state - The global graph state.
 * @returns null if valid, or a string describing the error if invalid.
 */
export type AgentOutputValidator = (result: SubAgentResult, taskId: string, state: GlobalGraphState) => string | null;

export interface OrchestratorState {
	tasks?: Task[];
	taskQueue?: string[][]; // Topologically sorted task IDs grouped by independent execution levels
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
	internal: Annotation<{ dbService: DbService; metadata?: any }>({
		reducer: (oldState, newState) => newState ?? oldState,
	}),
	userQuery: Annotation<string | undefined>({
		reducer: (oldState, newState) => newState ?? oldState,
		default: () => undefined,
	}),
	action: Annotation<unknown>({
		// TODO: implement core details of action (e.g. HITL, approvals) later
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
	// Additional context can be added here in the future
});

export type GlobalGraphState = typeof GraphState.State;
