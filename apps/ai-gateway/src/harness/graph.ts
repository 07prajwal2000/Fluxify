import { StateGraph, END, START, Send } from "@langchain/langgraph";
import { GraphState, type GlobalGraphState, AgentNode } from "./types";
import { RouterAgent, DiscussionAgent, VerifyUserQueryAgent, PlannerAgent, OrchestratorAgent, HumanInTheLoopAgent, SupervisorAgent, RouteConfigAgent, TaskGeneratorAgent } from "./agents";

const workflow = new StateGraph(GraphState)
	.addNode(AgentNode.ROUTER, async (state: GlobalGraphState) => {
		const agent = new RouterAgent(state);
		return await agent.execute();
	})
	.addNode(AgentNode.VERIFY_USER_QUERY, async (state: GlobalGraphState) => {
		const agent = new VerifyUserQueryAgent(state);
		return await agent.execute();
	})
	.addNode(AgentNode.DISCUSSION, async (state: GlobalGraphState) => {
		const agent = new DiscussionAgent(state);
		return await agent.execute();
	})
	.addNode(AgentNode.PLANNER, async (state: GlobalGraphState) => {
		const agent = new PlannerAgent(state);
		return await agent.execute();
	})
	.addNode(AgentNode.TASK_GENERATOR, async (state: GlobalGraphState) => {
		const agent = new TaskGeneratorAgent(state);
		return await agent.execute();
	})
	.addNode(AgentNode.ORCHESTRATOR, async (state: GlobalGraphState) => {
		const agent = new OrchestratorAgent(state);
		return await agent.execute();
	})
	.addNode(AgentNode.HUMAN_IN_THE_LOOP, async (state: GlobalGraphState) => {
		const agent = new HumanInTheLoopAgent(state);
		return await agent.execute();
	})
	.addNode(AgentNode.ROUTE_CONFIG_AGENT, async (state: GlobalGraphState) => {
		const agent = new RouteConfigAgent(state);
		return await agent.execute();
	})
	.addNode(AgentNode.SUPERVISOR, async (state: GlobalGraphState) => {
		const agent = new SupervisorAgent(state);
		return await agent.execute();
	})
	.addEdge(START, AgentNode.ROUTER)
	.addConditionalEdges(AgentNode.ROUTER, (state: GlobalGraphState) => {
		if (state.nextRoute === AgentNode.VERIFY_USER_QUERY) {
			return AgentNode.VERIFY_USER_QUERY;
		} else if (state.nextRoute === AgentNode.DISCUSSION) {
			return AgentNode.DISCUSSION;
		}
		return END;
	})
	.addConditionalEdges(AgentNode.VERIFY_USER_QUERY, (state: GlobalGraphState) => {
		if (state.nextRoute === AgentNode.PLANNER) {
			return AgentNode.PLANNER;
		}
		return END;
	})
	.addConditionalEdges(AgentNode.PLANNER, (state: GlobalGraphState) => {
		if (state.nextRoute === AgentNode.HUMAN_IN_THE_LOOP) {
			return AgentNode.HUMAN_IN_THE_LOOP;
		}
		if (state.nextRoute === AgentNode.TASK_GENERATOR) {
			return AgentNode.TASK_GENERATOR;
		}
		return END;
	})
	.addConditionalEdges(AgentNode.TASK_GENERATOR, (state: GlobalGraphState) => {
		if (state.nextRoute === AgentNode.ORCHESTRATOR) {
			return AgentNode.ORCHESTRATOR;
		}
		return END;
	})
	.addConditionalEdges(AgentNode.ORCHESTRATOR, (state: GlobalGraphState) => {
		const dispatched = state.orchestratorState?.dispatchedTasks;
		if (dispatched && dispatched.length > 0) {
			return dispatched.map(
				(task) =>
					new Send(task.assignedAgentNode, {
						...state,
						activeTask: task,
					}),
			);
		}
		return END;
	})
	.addEdge(AgentNode.HUMAN_IN_THE_LOOP, END)
	.addEdge(AgentNode.DISCUSSION, END)
	.addEdge(AgentNode.ROUTE_CONFIG_AGENT, AgentNode.SUPERVISOR)
	.addEdge(AgentNode.SUPERVISOR, AgentNode.ORCHESTRATOR);

export const app = workflow.compile();
