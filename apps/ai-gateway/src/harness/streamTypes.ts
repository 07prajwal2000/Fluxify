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
 * HARNESS STREAM EVENT CONTRACT
 * ----------------------------------------------------------------------------
 * ONE event shape for everything the harness does. Every event answers the same
 * five questions:
 *   currentNode      which graph node is talking
 *   nodeId           which *instance* of it (sub-agents run several at once)
 *   nodeStatus       started | running | ended
 *   executionType    agent | tool
 *   plainTextMessage what to show the user, in plain English
 *
 * Events are appended to a Redis queue per run and published to NATS ->
 * socket.io. A client that connects mid-run gets the whole queue replayed as
 * `full_state`, then live events, so the two paths are byte-identical.
 *
 * See `harness_events.md` in this folder for the full flow and client guide.
 * ========================================================================== */

/** Which tier of the harness produced the event. */
export type HarnessLevel = "harness" | "sub_agent";

/** Synthetic node for run-level bookends (run started / run finished). It is
 *  deliberately NOT a member of `AgentNode` — no graph node is called "run". */
export const RUN_NODE = "run";

/** Anything that can appear as `currentNode`. */
export type HarnessEventNode = AgentNodeName | typeof RUN_NODE;

/** Lifecycle of one node (or one tool call) instance. Exactly one `started` and
 *  one `ended` per instance, with any number of `running` updates in between. */
export type HarnessNodeStatus = "started" | "running" | "ended";

/** Whether the harness is inside agent reasoning or executing a tool. */
export type HarnessExecutionType = "agent" | "tool";

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
 *
 * The discriminants are written as `${AgentNode.X}` — the enum stays the single
 * source of truth, but the resulting type is the plain string literal. Enum
 * members remain assignable to it (so servers can keep writing `AgentNode.X`),
 * while clients that must not import the enum (it drags langgraph into the
 * bundle) can still build and narrow these payloads from string literals.
 */
export type HarnessNodePayload =
	| { node: `${AgentNode.ROUTER}`; data: RouterState }
	| { node: `${AgentNode.VERIFY_USER_QUERY}`; data: VerifyUserQueryState }
	| { node: `${AgentNode.PLANNER}`; data: PlannerState }
	| { node: `${AgentNode.DISCUSSION}`; data: DiscussionState }
	| {
			node: `${AgentNode.TASK_GENERATOR}`;
			data: { tasksByLevel: HarnessTaskView[][] };
	  }
	| {
			node: `${AgentNode.ORCHESTRATOR}`;
			data: { tasksByLevel: HarnessTaskView[][]; activeLevel: number };
	  }
	| {
			node: `${AgentNode.BLOCK_BUILDER}`;
			data: { task: HarnessTaskView; result?: SubAgentResult };
	  }
	| {
			node: `${AgentNode.ROUTE_CONFIG_AGENT}`;
			data: { task: HarnessTaskView; result?: SubAgentResult };
	  }
	| {
			node: `${AgentNode.SUPERVISOR}`;
			data: { tasksByLevel: HarnessTaskView[][] };
	  }
	| { node: `${AgentNode.SUMMARIZER}`; data: SummarizerState }
	| {
			node: `${AgentNode.HUMAN_IN_THE_LOOP}`;
			data: { reason: string; markdownPlan?: string };
	  }
	| { node: typeof RUN_NODE; data: HarnessRunResult };

/** Final outcome of a run, carried on the run-level `ended` event so a client
 *  never has to re-fetch to render the result. */
export interface HarnessRunResult {
	runStatus: HarnessRunStatus;
	/** The markdown the harness produced (summary, discussion answer, or plan). */
	result?: string;
	/** Artifact row backing the summary, when one was persisted. */
	artifactId?: string;
	/** Why the run failed or was interrupted. Absent on success. */
	error?: string;
}

/**
 * The one event shape. Emitted for node entry/exit, in-node progress, tool
 * calls, and the run-level bookends — nothing else is ever sent.
 */
export interface HarnessStreamEvent {
	conversationId: string;
	runId: string;
	/** The graph node this event is about (`"run"` for run-level bookends). */
	currentNode: HarnessEventNode;
	/**
	 * Instance key. `currentNode` for singleton nodes; `currentNode:<taskId>` for
	 * sub-agents, since the orchestrator can run several blockBuilders at once.
	 * Stable across the started/running/ended events of one execution — use it as
	 * the UI row key, not `currentNode`.
	 */
	nodeId: string;
	nodeStatus: HarnessNodeStatus;
	executionType: HarnessExecutionType;
	/** Tool being executed. Only set when `executionType === "tool"`. */
	toolName?: string;
	/** One short sentence for the user. Always present, never empty. */
	plainTextMessage: string;
	runStatus: HarnessRunStatus;
	level: HarnessLevel;
	/** Structured data for nodes that produce some (plan, task DAG, result...). */
	payload?: HarnessNodePayload;
	timestamp: number;
}

/** Cached per-run event queue, replayed to any client that (re)connects. */
export interface HarnessSnapshot {
	conversationId: string;
	runId: string;
	runStatus: HarnessRunStatus;
	currentNode?: HarnessEventNode;
	currentLevel?: HarnessLevel;
	events: HarnessStreamEvent[];
	updatedAt: number;
}

/* ============================================================================
 * STATIC NODE MAPS
 * ========================================================================== */

/** Sub-agent nodes are dispatched by the orchestrator with an `activeTask`. */
const SUB_AGENT_NODES: ReadonlySet<AgentNodeName> = new Set<AgentNodeName>([
	AgentNode.BLOCK_BUILDER,
	AgentNode.ROUTE_CONFIG_AGENT,
]);

export function levelForNode(node: HarnessEventNode): HarnessLevel {
	return SUB_AGENT_NODES.has(node as AgentNodeName) ? "sub_agent" : "harness";
}

/** Instance key for a node execution — see `HarnessStreamEvent.nodeId`. */
export function nodeIdFor(node: HarnessEventNode, taskId?: string): string {
	return taskId ? `${node}:${taskId}` : node;
}

/** Human-readable node names for user-facing messages (e.g. failure reports). */
const NODE_LABELS: Record<string, string> = {
	[AgentNode.ROUTER]: "request router",
	[AgentNode.CLASSIFIER]: "request classifier",
	[AgentNode.VERIFY_USER_QUERY]: "request verification",
	[AgentNode.PLANNER]: "planner",
	[AgentNode.TASK_GENERATOR]: "task generator",
	[AgentNode.DISCUSSION]: "discussion agent",
	[AgentNode.BLOCK_BUILDER]: "block builder",
	[AgentNode.ORCHESTRATOR]: "orchestrator",
	[AgentNode.HUMAN_IN_THE_LOOP]: "plan review",
	[AgentNode.ROUTE_CONFIG_AGENT]: "route configurator",
	[AgentNode.SUPERVISOR]: "supervisor",
	[AgentNode.SUMMARIZER]: "summarizer",
	[RUN_NODE]: "AI harness",
};

export function labelForNode(node?: HarnessEventNode): string {
	return (node && NODE_LABELS[node]) || "AI harness";
}

/* ----------------------------------------------------------------------------
 * PLAIN-TEXT MESSAGES
 * ----------------------------------------------------------------------------
 * Every event carries a sentence the UI can render verbatim. Node entry/exit
 * uses the table below; mid-node progress ("found 3 routes") comes from the
 * agent itself via `dispatchAgentEvent`.
 * -------------------------------------------------------------------------- */

const NODE_MESSAGES: Record<string, { started: string; ended: string }> = {
	[AgentNode.ROUTER]: {
		started: "Understanding your request",
		ended: "Request understood",
	},
	[AgentNode.CLASSIFIER]: {
		started: "Classifying your request",
		ended: "Request classified",
	},
	[AgentNode.VERIFY_USER_QUERY]: {
		started: "Checking whether this can be built",
		ended: "Capability check finished",
	},
	[AgentNode.PLANNER]: {
		started: "Drafting an implementation plan",
		ended: "Plan ready",
	},
	[AgentNode.TASK_GENERATOR]: {
		started: "Breaking the plan into tasks",
		ended: "Tasks ready",
	},
	[AgentNode.DISCUSSION]: {
		started: "Thinking about your question",
		ended: "Answer ready",
	},
	[AgentNode.ORCHESTRATOR]: {
		started: "Scheduling the next tasks",
		ended: "Tasks scheduled",
	},
	[AgentNode.BLOCK_BUILDER]: {
		started: "Building workflow blocks",
		ended: "Blocks built",
	},
	[AgentNode.ROUTE_CONFIG_AGENT]: {
		started: "Configuring the API route",
		ended: "Route configured",
	},
	[AgentNode.SUPERVISOR]: {
		started: "Reviewing task results",
		ended: "Review finished",
	},
	[AgentNode.SUMMARIZER]: {
		started: "Summarising the changes",
		ended: "Summary ready",
	},
	[AgentNode.HUMAN_IN_THE_LOOP]: {
		started: "Waiting for your review",
		ended: "Review received",
	},
};

/** Sentence for a node entering/leaving. `running` has no default — the agent
 *  supplies its own progress text. */
export function nodeMessage(
	node: HarnessEventNode,
	status: "started" | "ended",
): string {
	const entry = NODE_MESSAGES[node];
	if (entry) return entry[status];
	return status === "started"
		? `Starting ${labelForNode(node)}`
		: `Finished ${labelForNode(node)}`;
}

/** What each tool is doing, in the user's words rather than the tool's name. */
const TOOL_MESSAGES: Record<string, string> = {
	search_docs: "Searching the documentation",
	find_resource: "Looking up project resources",
	get_route_details: "Reading route details",
	get_block_schemas: "Reading block schemas",
	get_agent_output: "Reading a previous task's output",
	get_artifact: "Reading an earlier summary",
};

/**
 * Sentence for a tool call. `summary` is a short result description supplied by
 * the tool loop (e.g. "3 results"); `error` replaces it when the tool threw.
 */
export function toolMessage(
	toolName: string,
	status: "started" | "ended",
	summary?: string,
	error?: string,
): string {
	const label = TOOL_MESSAGES[toolName] ?? `Running ${toolName}`;
	if (status === "started") return `${label}…`;
	if (error) return `${label} — failed: ${error}`;
	return summary ? `${label} — found ${summary}` : `${label} — done`;
}

/** Maps a node to the run status it represents while executing. */
export function runStatusForNode(node: HarnessEventNode): HarnessRunStatus {
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
		case AgentNode.BLOCK_BUILDER:
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
