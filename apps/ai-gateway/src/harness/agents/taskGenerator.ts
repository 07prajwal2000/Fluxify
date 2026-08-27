import { type GlobalGraphState, type Task, AgentNode } from "../types";
import { BaseAgent } from "./base";
import { subAgents } from "./sub-agents";
import { z } from "zod";
import { dispatchAgentEvent } from "../callbacks";
import { renderProjectInventory } from "../internal/projectInventory";
import { createFindResourceTool } from "../tools/findResource";
import { createGetArtifactTool } from "../tools/getArtifact";
import { logger } from "@fluxify/common";

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
	escalate: z
		.boolean()
		.default(false)
		.describe(
			"Set true ONLY when no plan was written and the request turns out to need more than one target or is too ambiguous to break down. Return no tasks with it.",
		),
	escalateReason: z
		.string()
		.nullish()
		.describe("Short reason for escalating. Required when escalate is true."),
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
		.default([])
		.describe("Directed Acyclic Graph (DAG) of tasks to execute the plan"),
});

/** Appended to the user turn (never the system prompt — see
 * `AgentInvokeOptions.context`) when the router sent a single-target build
 * straight here. Without a planner ahead of it this agent is the only one that
 * reads the request, so it gets the lookup tools the planner normally carries
 * and a way to hand the request back when it turns out not to be simple. */
const NO_PLAN_NOTE = `## No plan was written for this request
The router judged this request simple enough to skip planning, so break down the user's message directly.
- Emit at most 2 tasks, and still follow the Route Canvas Order and Custom Block Order rules above.
- **Resolve the target from what you already have before reaching for a tool.** In order: a "Current context" block above (it names \`targetType\` and \`targetId\` outright), then an \`(id: <value>)\` written into the user's message — the composer puts a real database ID there when the user picks a resource, so use that value as-is — then the project inventory. A tool call is only for what none of those cover.
- \`find_resource\` finds a resource the above do not name. When you already hold its ID and only need its details, pass \`searchBy: "id"\`; the default keyword search matches names and descriptions and will never match an ID.
- \`get_artifact\` reads back work an earlier run in this conversation produced, and takes ONLY a \`sub_artifact_id\`/\`artifact_id\` token from an earlier assistant message. Never pass it a route, custom block, or other database ID — that is not what it holds. Use it when the request points at prior work ("the route you just made"); work that was proposed but never applied never appears in the inventory.
- Put the plain resource ID in every task description. Never guess one.
- If, after looking things up, the request needs more than 2 tasks, spans several resources, or stays ambiguous, set \`escalate: true\` with a short \`escalateReason\` and return no tasks. A full plan will be written and you will be called again.`;

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

	return { tasks: mergeChains(kept, notes), notes };
}

/**
 * Contracts a linear chain of same-agent tasks into one task.
 *
 * The planner writes a *user-facing* plan ("add the block", "configure it",
 * "return it in the response") and the task generator turns each bullet into
 * its own task, all on the same sub-agent and chained one after the other.
 * Rule 8 of its prompt says to consolidate those, and it routinely doesn't.
 *
 * The result is several `blockBuilder` runs editing one canvas in series: each
 * regenerates the whole graph from the previous one's output, so every hop is
 * another chance to drop a field the supervisor then rejects — and the user
 * watches three agents do one edit. Merging is safe only for a true chain:
 * B depends on A alone and nothing else depends on A, so no other task's
 * ordering changes. Independent same-agent tasks (two different routes) are
 * left alone.
 */
function mergeChains(tasks: Task[], notes: string[]): Task[] {
	const byId = new Map(tasks.map((t) => [t.id, t]));
	const dependents = new Map<string, string[]>();
	for (const t of tasks) {
		for (const dep of t.dependsOnAgentId) {
			dependents.set(dep, [...(dependents.get(dep) ?? []), t.id]);
		}
	}

	const merged = new Set<string>();
	for (const task of tasks) {
		if (merged.has(task.id)) continue;
		// Walk forward while the single dependent is the same agent.
		for (;;) {
			const next = dependents.get(task.id) ?? [];
			if (next.length !== 1) break;
			const child = byId.get(next[0]!);
			if (
				!child ||
				merged.has(child.id) ||
				child.assignedAgentNode !== task.assignedAgentNode ||
				child.dependsOnAgentId.length !== 1
			)
				break;

			task.description = `${task.description}

${child.title}: ${child.description}`;
			// The child's dependents inherit the merged task.
			for (const id of dependents.get(child.id) ?? []) {
				const t = byId.get(id);
				if (t)
					t.dependsOnAgentId = [
						...new Set(
							t.dependsOnAgentId.map((d) => (d === child.id ? task.id : d)),
						),
					].filter((d) => d !== t.id);
			}
			dependents.set(task.id, dependents.get(child.id) ?? []);
			merged.add(child.id);
			notes.push(
				`Task "${child.title}" was merged into "${task.title}": both run on ${task.assignedAgentNode} one after the other, so they are one edit.`,
			);
		}
	}

	return tasks.filter((t) => !merged.has(t.id));
}

/** Whether to hand the request back to the planner. Gated on there being no
 * plan yet: a planner run always leaves one behind, so escalation can fire at
 * most once. Without that gate planner → task generator → planner loops until
 * the graph's recursion limit. */
export function shouldEscalateToPlanner(
	markdownPlan: string | undefined,
	escalate: boolean,
): boolean {
	return !markdownPlan && escalate;
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

		// Volatile — kept out of the system prompt so the prefix stays cacheable
		// (see `AgentInvokeOptions.context`).
		const scratchPadText = this.state.scratchpad?.length
			? `## Context / Scratch Pad from Previous Agents\nHere is information gathered from previous steps:\n${this.state.scratchpad.map((s) => `- ${s}`).join("\n")}`
			: "";
		const projectInventory = renderProjectInventory(
			this.state.internal?.metadata?.projectInventory,
		);

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
9. **Custom Block Order**: For a new custom block, first assign one \`customBlockConfig\` task defining metadata and inputParams, then assign the \`blockBuilder\` canvas task with \`dependsOnAgentId\` containing that config task id. Its completed output is injected automatically. For an existing custom block whose caller contract changes, use the same order. Do not use \`routeConfig\` for custom blocks.
10. **Route Canvas Order**: When building a new route and its canvas, assign the \`routeConfig\` task first, then make the \`blockBuilder\` task depend on it through \`dependsOnAgentId\`. The route configuration output is injected automatically, so do not tell the Block Builder to fetch it with a tool.

If there are no sub-agents available, output an empty task list.`;

		// No plan means the router took the fast path (a planner run always leaves
		// one behind, HITL resumes included), so this agent stands in for it.
		const plan = this.state.plannerState?.markdownPlan;

		const response = (await this.state.agentWrapper.invokeAgent({
			zodSchema: taskSchema,
			systemPrompt,
			// The "Current context" block goes in only without a plan. With one, the
			// planner already read it and left the ids in the scratchpad, so
			// re-rendering a whole canvas here would be tokens for nothing.
			context: [
				scratchPadText,
				projectInventory,
				...(plan
					? []
					: [
							this.state.internal?.metadata?.contextBlock ?? "",
							NO_PLAN_NOTE,
						]),
			]
				.filter(Boolean)
				.join("\n\n"),
			// With a plan, that plan is the whole brief and history only dilutes it.
			// Without one, the request may lean on earlier turns ("that route").
			messages: plan ? [] : this.state.messages,
			historyMessageCount: plan ? undefined : this.state.historyMessageCount,
			userQuery: plan ? `Plan to execute:\n${plan}` : this.state.userQuery,
			// The planner normally resolves resources and leaves the ids in the
			// scratchpad. Skipping it means resolving them here instead — but only
			// here: on the planned path these calls would just repeat its work, and
			// the run-scoped memo saves the second execution, not the round trip.
			tools: plan
				? []
				: [
						createFindResourceTool(
							this.state.internal.dbService,
							this.state.internal.metadata || {},
						),
						createGetArtifactTool(
							this.state.internal.dbService,
							this.state.internal.metadata || {},
						),
					],
			agentNode: AgentNode.TASK_GENERATOR,
		})) as z.infer<typeof taskSchema>;

		// The router judges simplicity before any lookup, so this agent is the
		// first to see what the request actually touches. Handing it back costs one
		// call; a shallow DAG costs the user a half-built project.
		if (shouldEscalateToPlanner(plan, response.escalate)) {
			const reason =
				response.escalateReason?.trim() ||
				"The request needs more than a single-target build.";
			logger.info("[TaskGenerator] Escalating to the planner", { reason });
			await dispatchAgentEvent({
				name: "agent_status",
				data: {
					status: "Request needs a plan first",
					agent: AgentNode.TASK_GENERATOR,
					data: { reason },
				},
			});
			return {
				currentAgent: AgentNode.TASK_GENERATOR,
				nextRoute: AgentNode.PLANNER,
				scratchpad: [`Task generation escalated for planning: ${reason}`],
			};
		}

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
