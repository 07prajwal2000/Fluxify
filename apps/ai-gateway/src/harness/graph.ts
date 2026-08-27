import { StateGraph, END, START, Send } from "@langchain/langgraph";
import { GraphState, type GlobalGraphState, AgentNode } from "./types";
import {
	RouterAgent,
	DiscussionAgent,
	PlannerAgent,
	OrchestratorAgent,
	HumanInTheLoopAgent,
	SupervisorAgent,
	RouteConfigAgent,
	CustomBlockConfigAgent,
	TaskGeneratorAgent,
	BlockBuilderAgent,
	SummarizerAgent,
} from "./agents";

const workflow = new StateGraph(GraphState)
	.addNode(AgentNode.ROUTER, async (state: GlobalGraphState) => {
		const agent = new RouterAgent(state);
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
	.addNode(AgentNode.CUSTOM_BLOCK_CONFIG_AGENT, async (state: GlobalGraphState) => {
		const agent = new CustomBlockConfigAgent(state);
		return await agent.execute();
	})
	.addNode(AgentNode.BLOCK_BUILDER, async (state: GlobalGraphState) => {
		const agent = new BlockBuilderAgent(state);
		return await agent.execute();
	})
	.addNode(AgentNode.SUPERVISOR, async (state: GlobalGraphState) => {
		const agent = new SupervisorAgent(state);
		return await agent.execute();
	})
	.addNode(AgentNode.SUMMARIZER, async (state: GlobalGraphState) => {
		const agent = new SummarizerAgent(state);
		return await agent.execute();
	})
	// A HITL resume skips the parts of the cycle the decision already settled:
	// `approve` needs no re-planning or re-routing — it goes straight to
	// breaking the (already-approved) plan into tasks. `review` re-enters at the
	// router, which re-classifies and re-checks capability against the revised
	// ask before planning again. `reject` never reaches here — the harness
	// short-circuits it before invoking the graph at all (see
	// FluxifyHarness.continue).
	.addConditionalEdges(START, (state: GlobalGraphState) => {
		if (state.action?.type === "approve") {
			return AgentNode.TASK_GENERATOR;
		}
		return AgentNode.ROUTER;
	})
	// The router is also the capability gate: an unbuildable request leaves
	// `nextRoute` unset and ends the run with `routerState.rejectReason`.
	// A single-target build skips the planner and is broken into tasks directly;
	// the task generator hands it back to the planner if that turns out wrong.
	.addConditionalEdges(AgentNode.ROUTER, (state: GlobalGraphState) => {
		if (state.nextRoute === AgentNode.PLANNER) {
			return AgentNode.PLANNER;
		} else if (state.nextRoute === AgentNode.TASK_GENERATOR) {
			return AgentNode.TASK_GENERATOR;
		} else if (state.nextRoute === AgentNode.DISCUSSION) {
			return AgentNode.DISCUSSION;
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
		// Escalation from the planner-less fast path. Only reachable once: the
		// planner leaves a plan behind, and a plan disables the escalate branch.
		if (state.nextRoute === AgentNode.PLANNER) {
			return AgentNode.PLANNER;
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
		// Build finished: summarize any produced work before ending.
		const tasks = state.orchestratorState?.tasks;
		if (tasks && tasks.length > 0) {
			return AgentNode.SUMMARIZER;
		}
		return END;
	})
	.addEdge(AgentNode.HUMAN_IN_THE_LOOP, END)
	.addEdge(AgentNode.DISCUSSION, END)
	.addEdge(AgentNode.ROUTE_CONFIG_AGENT, AgentNode.SUPERVISOR)
	.addEdge(AgentNode.CUSTOM_BLOCK_CONFIG_AGENT, AgentNode.SUPERVISOR)
	.addEdge(AgentNode.BLOCK_BUILDER, AgentNode.SUPERVISOR)
	.addEdge(AgentNode.SUPERVISOR, AgentNode.ORCHESTRATOR)
	.addEdge(AgentNode.SUMMARIZER, END);

export const app = workflow.compile();
