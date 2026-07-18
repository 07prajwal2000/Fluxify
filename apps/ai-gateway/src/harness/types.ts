import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import type { BaseAgentWrapper } from "./models/base";
import type { DbService } from "./internal/dbService";

export type AgentNodeName = "router"; // Add more agent names here

export type CustomEventName = "agent_status" | "human_in_the_loop_required";

export interface AgentCustomEvent {
  name: CustomEventName;
  data: unknown;
}

export const GraphState = Annotation.Root({
	...MessagesAnnotation.spec,
	agentWrapper: Annotation<BaseAgentWrapper>({
		reducer: (oldState, newState) => newState ?? oldState,
		default: () => undefined as unknown as BaseAgentWrapper,
	}),
	internal: Annotation<{ dbService: DbService }>({
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
	// Additional context can be added here in the future
});

export type GlobalGraphState = typeof GraphState.State;
