import { BaseAgent } from "./base";
import { type GlobalGraphState, AgentNode, type Task } from "../types";
import { dispatchAgentEvent } from "../callbacks";
import { validateAgentOutput as validateRouteConfig } from "./sub-agents/routeConfig";
import { validateBlockBuilderOutput } from "./sub-agents/blockBuilder";

export class SupervisorAgent extends BaseAgent {
	constructor(state: GlobalGraphState) {
		super(state);
	}

	async execute(): Promise<Partial<GlobalGraphState>> {
		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "Aggregating and verifying results...",
				agent: AgentNode.SUPERVISOR,
			},
		});

		const dispatchedTasks = this.state.orchestratorState?.dispatchedTasks || [];
		const results = this.state.orchestratorState?.subAgentResults || {};
		const tasks = this.state.orchestratorState?.tasks || [];
		const scratchpad = [...(this.state.scratchpad || [])];

		let hasErrors = false;

		// Statuses are written to the `tasks` entry by id, not left to the fact that
		// dispatchedTasks happens to hold the same object references — the
		// orchestrator only advances when a task's status in `tasks` is settled, so
		// a lost write here stalls the whole build.
		const setStatus = (taskId: string, status: Task["status"]) => {
			const entry = tasks.find((t) => t.id === taskId);
			if (entry) entry.status = status;
		};

		for (let i = 0; i < dispatchedTasks.length; i++) {
			const task = dispatchedTasks[i];
			// Only verify tasks that are currently running
			if (task.status !== "running") continue;

			const result = results[task.id];

			if (!result) {
				dispatchedTasks[i].status = "failed";
				setStatus(task.id, "failed");
				scratchpad.push(
					`[Supervisor Error - Task ${task.id}]: No result provided by agent.`,
				);
				hasErrors = true;
				continue;
			}

			let error: string | null = null;
			switch (task.assignedAgentNode) {
				case AgentNode.ROUTE_CONFIG_AGENT:
					error = await validateRouteConfig(result, task.id, this.state);
					break;
				case AgentNode.BLOCK_BUILDER:
					error = await validateBlockBuilderOutput(result, task.id, this.state);
					break;
				default:
					// No validator for this agent
					break;
			}

			if (error) {
				dispatchedTasks[i].status = "failed";
				setStatus(task.id, "failed");
				scratchpad.push(
					`[Supervisor Error - Task ${task.id} (${task.assignedAgentNode})]: ${error}`,
				);
				hasErrors = true;
			} else {
				dispatchedTasks[i].status = "completed";
				setStatus(task.id, "completed");
			}
		}

		if (hasErrors) {
			await dispatchAgentEvent({
				name: "agent_status",
				data: {
					status: "Supervisor found errors in sub-agent outputs.",
					agent: AgentNode.SUPERVISOR,
				},
			});
		}

		return {
			currentAgent: AgentNode.SUPERVISOR,
			nextRoute: AgentNode.ORCHESTRATOR,
			orchestratorState: {
				...this.state.orchestratorState,
				tasks,
				// Clear dispatchedTasks as they are now verified
				dispatchedTasks: [],
			},
			scratchpad,
		};
	}
}
