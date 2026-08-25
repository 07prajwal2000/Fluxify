import { BaseAgent } from "./base";
import { type GlobalGraphState, AgentNode, type Task } from "../types";
import { dispatchAgentEvent } from "../callbacks";
import { validateAgentOutput as validateRouteConfig } from "./sub-agents/routeConfig";
import { validateCustomBlockConfigOutput } from "./sub-agents/customBlockConfig";
import { validateBlockBuilderOutput } from "./sub-agents/blockBuilder";

/** Total validation rounds a task gets — the first run plus its retries. */
export const MAX_TASK_ATTEMPTS = 2;

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

		// A rejection is feedback, not a verdict. The sub-agent prompts read
		// `supervisorReviews`, so put the reason there and send the task back to
		// `pending` — the orchestrator re-dispatches it with the correction in
		// context. Only once the attempts run out does the task fail terminally,
		// and a terminal failure must take its dependents with it (orchestrator).
		const reject = (
			i: number,
			task: Task,
			reason: string,
			terminal = false,
		) => {
			const entry = tasks.find((t) => t.id === task.id) ?? task;
			entry.attempts = (entry.attempts ?? 0) + 1;
			entry.supervisorReviews = reason;

			const isTerminal = terminal || entry.attempts >= MAX_TASK_ATTEMPTS;
			const status = isTerminal ? "failed" : "pending";
			dispatchedTasks[i].status = status;
			setStatus(task.id, status);
			scratchpad.push(
				isTerminal
					? `[Supervisor Error - Task ${task.id} (${task.assignedAgentNode})]: ${reason}`
					: `[Supervisor Retry ${entry.attempts}/${MAX_TASK_ATTEMPTS} - Task ${task.id} (${task.assignedAgentNode})]: ${reason}`,
			);
			hasErrors = true;
		};

		for (let i = 0; i < dispatchedTasks.length; i++) {
			const task = dispatchedTasks[i];
			// Only verify tasks that are currently running
			if (task.status !== "running") continue;

			const result = results[task.id];

			if (!result) {
				reject(i, task, "No result provided by agent.");
				continue;
			}

			const blockBuilderResult = result as {
				status?: string;
				reasoning?: string;
			};
			if (
				task.assignedAgentNode === AgentNode.BLOCK_BUILDER &&
				blockBuilderResult.status === "impossible" &&
				blockBuilderResult.reasoning?.trim()
			) {
				reject(
					i,
					task,
					blockBuilderResult.reasoning,
					true,
				);
				continue;
			}

			let error: string | null = null;
			switch (task.assignedAgentNode) {
				case AgentNode.ROUTE_CONFIG_AGENT:
					error = await validateRouteConfig(result, task.id, this.state);
					break;
				case AgentNode.CUSTOM_BLOCK_CONFIG_AGENT:
					error = await validateCustomBlockConfigOutput(result, task.id, this.state);
					break;
				case AgentNode.BLOCK_BUILDER:
					error = await validateBlockBuilderOutput(result, task.id, this.state);
					break;
				default:
					// No validator for this agent
					break;
			}

			if (error) {
				reject(i, task, error);
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
