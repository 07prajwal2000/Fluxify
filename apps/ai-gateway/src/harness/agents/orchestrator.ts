import { BaseAgent } from "./base";
import {
	type GlobalGraphState,
	AgentNode,
	type Task,
	type AgentNodeName,
} from "../types";
import { dispatchAgentEvent } from "../callbacks";

export class OrchestratorAgent extends BaseAgent {
	constructor(state: GlobalGraphState) {
		super(state);
	}

	async execute(): Promise<Partial<GlobalGraphState>> {
		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "Orchestrating tasks...",
				agent: AgentNode.ORCHESTRATOR,
			},
		});

		let tasks = this.state.orchestratorState?.tasks || [];
		let taskQueue = this.state.orchestratorState?.taskQueue || [];

		if (taskQueue.length === 0) {
			await dispatchAgentEvent({
				name: "agent_status",
				data: {
					status: "All tasks completed.",
					agent: AgentNode.ORCHESTRATOR,
				},
			});
			return {
				currentAgent: AgentNode.ORCHESTRATOR,
				nextRoute: undefined, // Let graph logic end the flow
				orchestratorState: {
					...this.state.orchestratorState,
					tasks,
					taskQueue,
				},
			};
		}

		// Pop the next level of tasks
		const nextTaskIds = taskQueue.shift() || [];
		const nextRoutes: AgentNodeName[] = [];
		const assignedTaskIds: string[] = [];
		const dispatchedTasks: Task[] = [];

		for (const nextTaskId of nextTaskIds) {
			const nextTaskIndex = tasks.findIndex((t) => t.id === nextTaskId);
			if (nextTaskIndex !== -1) {
				tasks[nextTaskIndex].status = "running";
				nextRoutes.push(tasks[nextTaskIndex].assignedAgentNode);
				assignedTaskIds.push(nextTaskId);
				dispatchedTasks.push(tasks[nextTaskIndex]);
			}
		}

		let nextRoute: AgentNodeName | AgentNodeName[] | undefined = undefined;
		if (nextRoutes.length === 1) {
			nextRoute = nextRoutes[0];
		} else if (nextRoutes.length > 1) {
			nextRoute = nextRoutes;
		}

		if (nextRoutes.length > 0) {
			await dispatchAgentEvent({
				name: "agent_status",
				data: {
					status: `Routing to tasks: ${assignedTaskIds.join(", ")}`,
					agent: AgentNode.ORCHESTRATOR,
					data: { taskIds: assignedTaskIds, nextRoute },
				},
			});
		}

		return {
			currentAgent: AgentNode.ORCHESTRATOR,
			nextRoute,
			orchestratorState: {
				...this.state.orchestratorState,
				tasks,
				taskQueue,
				dispatchedTasks,
			},
		};
	}
}
