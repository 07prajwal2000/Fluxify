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

		const tasks = this.state.orchestratorState?.tasks || [];

		// Readiness is derived from task statuses, never from popping a queue.
		// A level with N tasks fans out to N sub-agents, so the graph runs N
		// supervisors and N orchestrators in the following supersteps — a
		// queue-shifting orchestrator consumed N levels per round, skipping tasks
		// and dispatching overlapping levels concurrently. Deriving the next level
		// makes those concurrent runs produce the identical result instead.
		const byId = new Map(tasks.map((task) => [task.id, task]));

		// A failed dependency is not a satisfied one. Dispatching its dependents
		// anyway produced work referencing a route that was never configured — and
		// the run still finalized as `completed`. They fail with it instead,
		// transitively, since a chain can be several levels deep. An unknown
		// dependency id can't fail and can't block: the task generator already
		// strips those, so anything left is treated as satisfied rather than
		// stalling the build forever.
		for (let changed = true; changed; ) {
			changed = false;
			for (const task of tasks) {
				if (task.status !== "pending") continue;
				const failedDep = (task.dependsOnAgentId ?? []).find(
					(depId) => byId.get(depId)?.status === "failed",
				);
				if (!failedDep) continue;
				task.status = "failed";
				// The summarizer puts this reason in front of the user verbatim, so
				// name the dependency the way the plan did — a raw task id means
				// nothing to someone who never saw the task graph.
				task.supervisorReviews = `Skipped — it depends on "${byId.get(failedDep)?.title ?? failedDep}", which failed.`;
				changed = true;
			}
		}

		const isSatisfied = (task?: Task) =>
			task ? task.status === "completed" : true;

		const readyTasks = tasks.filter(
			(task) =>
				task.status === "pending" &&
				(task.dependsOnAgentId ?? []).every((depId) =>
					isSatisfied(byId.get(depId)),
				),
		);

		if (readyTasks.length === 0) {
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
					dispatchedTasks: [],
				},
			};
		}

		const nextRoutes: AgentNodeName[] = [];
		const assignedTaskIds: string[] = [];
		const dispatchedTasks: Task[] = [];

		for (const task of readyTasks) {
			task.status = "running";
			nextRoutes.push(task.assignedAgentNode);
			assignedTaskIds.push(task.id);
			dispatchedTasks.push(task);
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
				dispatchedTasks,
			},
		};
	}
}
