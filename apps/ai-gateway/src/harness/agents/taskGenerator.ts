import { type GlobalGraphState, type Task, AgentNode } from "../types";
import { BaseAgent } from "./base";
import { subAgents } from "./sub-agents";
import { z } from "zod";
import { dispatchAgentEvent } from "../callbacks";

function buildSubAgentsTable(): string {
	if (subAgents.length === 0) {
		return "No sub-agents currently available.";
	}
	const header =
		"| Agent Name | Node Name | Ability | Description |\n| --- | --- | --- | --- |";
	const rows = subAgents.map(
		(a) => `| ${a.name} | ${a.nodeName} | ${a.ability} | ${a.description} |`,
	);
	return [header, ...rows].join("\n");
}

const SUB_AGENTS_TABLE = buildSubAgentsTable();

const taskSchema = z.object({
	tasks: z
		.array(
			z.object({
				id: z
					.string()
					.describe("Short unique ID (3 chars and 2 digits, e.g., a12bc)"),
				title: z.string().describe("Title of the task"),
				description: z
					.string()
					.describe("Detailed description of what needs to be done"),
				dependsOnAgentId: z
					.array(z.string())
					.describe(
						"List of previous task IDs where their output gets injected to this task",
					),
				assignedAgentNode: z
					.string()
					.describe("The Node Name of the sub-agent assigned to this task"),
			}),
		)
		.describe("Directed Acyclic Graph (DAG) of tasks to execute the plan"),
});

/**
 * The model writes task ids, agent node names and dependency edges by hand, so
 * all three arrive wrong sometimes. Repair them here, before they reach the
 * graph, because each one fails badly downstream:
 *
 * - an unknown `assignedAgentNode` throws inside `new Send()` and kills the
 *   run; a *valid but wrong* one (`orchestrator`, `planner`) is worse — it
 *   dispatches back into the control plane and loops until `recursionLimit`.
 * - a `dependsOnAgentId` naming a task that doesn't exist leaves the child's
 *   in-degree permanently above zero, so the topological sort reports a cycle
 *   that isn't there.
 * - a duplicate id makes `supervisor.setStatus` update only the first match,
 *   stranding the other task as `running` forever.
 *
 * Repairs are recorded so the caller can put them in the scratchpad — a
 * dropped task is lost work and shouldn't happen silently.
 */
export function sanitizeTasks(
	raw: z.infer<typeof taskSchema>["tasks"],
): { tasks: Task[]; notes: string[] } {
	const validNodes = new Map(
		subAgents.map((a) => [a.nodeName.toLowerCase(), a.nodeName]),
	);
	const notes: string[] = [];

	const kept: Task[] = [];
	const seenIds = new Set<string>();

	for (const t of raw) {
		const node = validNodes.get(t.assignedAgentNode?.trim().toLowerCase());
		if (!node) {
			notes.push(
				`Task "${t.title}" was dropped: it was assigned to "${t.assignedAgentNode}", which is not an available sub-agent.`,
			);
			continue;
		}

		let id = t.id?.trim();
		if (!id || seenIds.has(id)) {
			const replacement = `t${kept.length}${Math.random().toString(36).slice(2, 5)}`;
			notes.push(
				`Task "${t.title}" had a ${id ? "duplicate" : "missing"} id${id ? ` ("${id}")` : ""}; re-keyed to "${replacement}".`,
			);
			id = replacement;
		}
		seenIds.add(id);

		kept.push({
			...t,
			id,
			assignedAgentNode: node,
			dependsOnAgentId: t.dependsOnAgentId ?? [],
			status: "pending",
		});
	}

	// Second pass: edges can only be checked once every surviving id is known.
	for (const task of kept) {
		const resolved = task.dependsOnAgentId.filter(
			(dep) => dep !== task.id && seenIds.has(dep),
		);
		if (resolved.length !== task.dependsOnAgentId.length) {
			notes.push(
				`Task "${task.title}" depended on ${task.dependsOnAgentId
					.filter((d) => !resolved.includes(d))
					.map((d) => `"${d}"`)
					.join(", ")}, which do not exist; those dependencies were removed.`,
			);
			task.dependsOnAgentId = resolved;
		}
	}

	return { tasks: kept, notes };
}

function topologicalSortByLevel(tasks: Task[]): string[][] {
	const inDegree = new Map<string, number>();
	const children = new Map<string, string[]>();
	const result: string[][] = [];

	for (const task of tasks) {
		inDegree.set(task.id, 0);
		children.set(task.id, []);
	}

	for (const task of tasks) {
		if (task.dependsOnAgentId) {
			for (const parentId of task.dependsOnAgentId) {
				inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
				if (!children.has(parentId)) {
					children.set(parentId, []);
				}
				children.get(parentId)!.push(task.id);
			}
		}
	}

	let queue: string[] = [];
	for (const [taskId, deg] of inDegree.entries()) {
		if (deg === 0) {
			queue.push(taskId);
		}
	}

	let processedCount = 0;

	while (queue.length > 0) {
		const nextQueue: string[] = [];
		const currentLevel: string[] = [];

		for (const taskId of queue) {
			currentLevel.push(taskId);
			processedCount++;

			const taskChildren = children.get(taskId) || [];
			for (const childId of taskChildren) {
				const currentDeg = inDegree.get(childId) || 0;
				inDegree.set(childId, currentDeg - 1);
				if (currentDeg - 1 === 0) {
					nextQueue.push(childId);
				}
			}
		}

		result.push(currentLevel);
		queue = nextQueue;
	}

	if (processedCount !== tasks.length) {
		throw new Error("Cyclic dependency detected in tasks");
	}

	return result;
}

export class TaskGeneratorAgent extends BaseAgent {
	constructor(state: GlobalGraphState) {
		super(state);
	}

	async execute(): Promise<Partial<GlobalGraphState>> {
		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "Generating tasks...",
				agent: AgentNode.TASK_GENERATOR,
			},
		});

		const scratchPadText = this.state.scratchpad?.length
			? `\n\n## Context / Scratch Pad from Previous Agents\nHere is information gathered from previous steps:\n${this.state.scratchpad.map((s) => `- ${s}`).join("\n")}`
			: "";

		const systemPrompt = `You are the Expert Task Generator Agent for Fluxify — an Agentic Low Code Backend Development Platform.
Your role is to act as the task planner for the Orchestrator. You receive a verified plan (created by the Planner Agent) and must break it down into a list of tasks. 
Each task must be assigned to an existing specialized sub-agent.

## Sub-Agents Available
The orchestrator relies on the following sub-agents. You MUST assign tasks ONLY to the \`Node Name\` of these sub-agents.
${SUB_AGENTS_TABLE}

## Instructions
1. Analyze the user's plan and the scratchpad.
2. Create a list of tasks that perfectly represent the steps needed to fulfill the plan.
3. Formulate these tasks into a Dependency Graph (DAG) by specifying \`dependsOnAgentId\` for tasks that require the output of prior tasks. 
4. Provide a clear title and a highly detailed description for each task. The sub-agent will solely rely on your description and context.
5. Generate a short 5-character ID for each task (3 letters, 2 digits).
6. **STRICT NO-CYCLE RULE**: Ensure the Dependency Graph is strictly acyclic. No task should depend on itself or form a circular dependency chain.
7. **Resource Identifiers**: The plan may contain \`:resource{type="..." identifier="..."}\` directives. You MUST extract the exact \`identifier\` value from these directives and explicitly include it in the task description for the assigned sub-agent so they know exactly which resource to operate on. Write the plain ID in the description — do NOT copy the directive syntax into task descriptions.
8. **Consolidate Tasks**: Combine related tasks that are assigned to the SAME sub-agent to minimize redundant graph executions. For example, if the plan involves adding blocks and connecting blocks, combine them into a single comprehensive task for the Block Builder Agent.

If there are no sub-agents available, output an empty task list.
${scratchPadText}`;

		// Provide the plan as the query to focus the LLM on breaking it down
		const planText = this.state.plannerState?.markdownPlan
			? `Plan to execute:\n${this.state.plannerState.markdownPlan}`
			: "No plan provided.";

		const response = (await this.state.agentWrapper.invokeAgent({
			zodSchema: taskSchema,
			systemPrompt,
			messages: [], // We only pass the plan to keep it strictly focused
			userQuery: planText,
			agentNode: AgentNode.TASK_GENERATOR,
		})) as z.infer<typeof taskSchema>;

		const { tasks: generatedTasks, notes } = sanitizeTasks(response.tasks);

		let taskQueue: string[][] = [];
		if (generatedTasks.length > 0) {
			taskQueue = topologicalSortByLevel(generatedTasks);
		}

		return {
			currentAgent: AgentNode.TASK_GENERATOR,
			nextRoute: AgentNode.ORCHESTRATOR,
			// `scratchpad`'s reducer appends, so return only the new notes.
			scratchpad: notes,
			orchestratorState: {
				...this.state.orchestratorState,
				tasks: generatedTasks,
				taskQueue,
			},
		};
	}
}
