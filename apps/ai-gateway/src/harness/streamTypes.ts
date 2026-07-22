import {
	AgentNode,
	type AgentNodeName,
	type Task,
	type RouterState,
	type VerifyUserQueryState,
	type PlannerState,
	type DiscussionState,
	type SummarizerState,
	type SubAgentResult,
} from "./types";

/* ============================================================================
 * HARNESS STREAM / SSE EVENT CONTRACT
 * ----------------------------------------------------------------------------
 * Structured, discriminated events emitted per node execution. Stored in Redis
 * (snapshot + event log) and pushed via BullMQ job progress -> QueueEvents ->
 * EventEmitter. The frontend infers the payload TS type from `node` + `level`.
 * ========================================================================== */

/** Which tier of the harness produced the event. */
export type HarnessLevel = "harness" | "sub_agent";

/** Lifecycle phase of the event. */
export type HarnessPhase = "node_start" | "node_end" | "status" | "hitl_required";

/** Mirrors agentHarnessRunStatusEnum in the DB schema. */
export type HarnessRunStatus =
	| "queued"
	| "routing"
	| "verifying"
	| "planning"
	| "orchestrating"
	| "executing"
	| "awaiting_hitl"
	| "completed"
	| "interrupted"
	| "failed";

/** A single task's live view, grouped by topological level for the UI. */
export interface HarnessTaskView {
	id: string;
	title: string;
	status: Task["status"];
	assignedAgentNode: AgentNodeName;
	level: number;
}

/**
 * Node-typed payload. Discriminated by `node` so the frontend can narrow to the
 * exact state slice a given node emits.
 */
export type HarnessNodePayload =
	| { node: AgentNode.ROUTER; data: RouterState }
	| { node: AgentNode.VERIFY_USER_QUERY; data: VerifyUserQueryState }
	| { node: AgentNode.PLANNER; data: PlannerState }
	| { node: AgentNode.DISCUSSION; data: DiscussionState }
	| { node: AgentNode.TASK_GENERATOR; data: { tasksByLevel: HarnessTaskView[][] } }
	| {
			node: AgentNode.ORCHESTRATOR;
			data: { tasksByLevel: HarnessTaskView[][]; activeLevel: number };
	  }
	| {
			node: AgentNode.BUILDER;
			data: { task: HarnessTaskView; result?: SubAgentResult };
	  }
	| {
			node: AgentNode.ROUTE_CONFIG_AGENT;
			data: { task: HarnessTaskView; result?: SubAgentResult };
	  }
	| { node: AgentNode.SUPERVISOR; data: { tasksByLevel: HarnessTaskView[][] } }
	| { node: AgentNode.SUMMARIZER; data: SummarizerState }
	| {
			node: AgentNode.HUMAN_IN_THE_LOOP;
			data: { reason: string; markdownPlan?: string };
	  };

/** The event streamed to clients (and cached) for every node execution. */
export interface HarnessStreamEvent {
	conversationId: string;
	runId: string;
	stepId?: string;
	level: HarnessLevel;
	phase: HarnessPhase;
	node: AgentNodeName;
	status: string;
	runStatus: HarnessRunStatus;
	payload?: HarnessNodePayload;
	timestamp: number;
}

/** Cached per-run snapshot used for SSE catch-up before live events stream in. */
export interface HarnessSnapshot {
	conversationId: string;
	runId: string;
	runStatus: HarnessRunStatus;
	currentNode?: AgentNodeName;
	currentLevel?: HarnessLevel;
	events: HarnessStreamEvent[];
	updatedAt: number;
}

/* ============================================================================
 * STATIC NODE MAPS
 * ========================================================================== */

/** Sub-agent nodes are dispatched by the orchestrator with an `activeTask`. */
const SUB_AGENT_NODES: ReadonlySet<AgentNodeName> = new Set<AgentNodeName>([
	AgentNode.BUILDER,
	AgentNode.ROUTE_CONFIG_AGENT,
]);

export function levelForNode(node: AgentNodeName): HarnessLevel {
	return SUB_AGENT_NODES.has(node) ? "sub_agent" : "harness";
}

/** Maps a node to the run status it represents while executing. */
export function runStatusForNode(node: AgentNodeName): HarnessRunStatus {
	switch (node) {
		case AgentNode.ROUTER:
			return "routing";
		case AgentNode.VERIFY_USER_QUERY:
			return "verifying";
		case AgentNode.PLANNER:
		case AgentNode.DISCUSSION:
			return "planning";
		case AgentNode.TASK_GENERATOR:
		case AgentNode.ORCHESTRATOR:
		case AgentNode.SUPERVISOR:
		case AgentNode.SUMMARIZER:
			return "orchestrating";
		case AgentNode.BUILDER:
		case AgentNode.ROUTE_CONFIG_AGENT:
			return "executing";
		case AgentNode.HUMAN_IN_THE_LOOP:
			return "awaiting_hitl";
		default:
			return "routing";
	}
}

/* ============================================================================
 * TASK-DAG-BY-LEVEL
 * ----------------------------------------------------------------------------
 * Groups tasks into topological levels from their dependencies (stable across
 * orchestrator taskQueue mutation) so the frontend renders tasks level-by-level
 * and updates each task's status as sub-agents finish.
 * ========================================================================== */

export function buildTasksByLevel(tasks: Task[] = []): HarnessTaskView[][] {
	if (tasks.length === 0) return [];

	const inDegree = new Map<string, number>();
	const children = new Map<string, string[]>();
	const byId = new Map<string, Task>();

	for (const task of tasks) {
		inDegree.set(task.id, 0);
		children.set(task.id, []);
		byId.set(task.id, task);
	}

	for (const task of tasks) {
		for (const parentId of task.dependsOnAgentId ?? []) {
			if (!byId.has(parentId)) continue; // ignore dangling deps
			inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
			children.get(parentId)!.push(task.id);
		}
	}

	let queue: string[] = [];
	for (const [taskId, deg] of inDegree.entries()) {
		if (deg === 0) queue.push(taskId);
	}

	const levels: HarnessTaskView[][] = [];
	let levelIndex = 0;
	let processed = 0;

	while (queue.length > 0) {
		const nextQueue: string[] = [];
		const currentLevel: HarnessTaskView[] = [];

		for (const taskId of queue) {
			const task = byId.get(taskId)!;
			currentLevel.push({
				id: task.id,
				title: task.title,
				status: task.status,
				assignedAgentNode: task.assignedAgentNode,
				level: levelIndex,
			});
			processed++;

			for (const childId of children.get(taskId) || []) {
				const deg = (inDegree.get(childId) || 0) - 1;
				inDegree.set(childId, deg);
				if (deg === 0) nextQueue.push(childId);
			}
		}

		levels.push(currentLevel);
		queue = nextQueue;
		levelIndex++;
	}

	// If a cycle left tasks unprocessed, surface them as a trailing level.
	if (processed !== tasks.length) {
		const remaining: HarnessTaskView[] = tasks
			.filter((t) => !levels.some((lvl) => lvl.some((v) => v.id === t.id)))
			.map((t) => ({
				id: t.id,
				title: t.title,
				status: t.status,
				assignedAgentNode: t.assignedAgentNode,
				level: levelIndex,
			}));
		if (remaining.length > 0) levels.push(remaining);
	}

	return levels;
}

/** Index of the first level that still has a pending/running task. */
export function activeLevelIndex(tasksByLevel: HarnessTaskView[][]): number {
	for (let i = 0; i < tasksByLevel.length; i++) {
		if (
			tasksByLevel[i].some(
				(t) => t.status === "pending" || t.status === "running",
			)
		) {
			return i;
		}
	}
	return Math.max(0, tasksByLevel.length - 1);
}
