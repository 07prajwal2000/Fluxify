import { expect, test } from "bun:test";
import type {
	HarnessSnapshot,
	HarnessStreamEvent,
	HarnessTaskView,
} from "@fluxify/ai-gateway/src/harness/clientContract";
import {
	applyMessage,
	type AiHarnessState,
	type ConversationUIState,
} from "./aiHarness";

const CONV = "conv-1";
const RUN = "run-1";

function blankState(): AiHarnessState {
	return {
		connected: false,
		activeConversationId: null,
		list: [],
		runs: {},
	};
}

function event(patch: Partial<HarnessStreamEvent>): HarnessStreamEvent {
	return {
		conversationId: CONV,
		runId: RUN,
		level: "harness",
		currentNode: "planner",
		nodeId: "planner",
		nodeStatus: "started",
		executionType: "agent",
		plainTextMessage: "Drafting an implementation plan",
		runStatus: "planning",
		timestamp: 1000,
		...patch,
	};
}

function feed(state: AiHarnessState, ...events: HarnessStreamEvent[]) {
	for (const e of events) {
		applyMessage(state, {
			type: "update",
			conversationId: e.conversationId,
			runId: e.runId,
			event: e,
		});
	}
	return state.runs[CONV] as ConversationUIState;
}

const tasks = (status: HarnessTaskView["status"]): HarnessTaskView[][] => [
	[{ id: "t1", title: "T1", status, assignedAgentNode: "blockBuilder", level: 0 }],
];

test("started/ended upsert one step by nodeId", () => {
	const run = feed(
		blankState(),
		event({ nodeStatus: "started", timestamp: 1 }),
		event({
			nodeStatus: "ended",
			timestamp: 2,
			payload: { node: "planner", data: { markdownPlan: "# plan" } },
		}),
	);
	expect(Object.keys(run.steps)).toEqual(["planner"]);
	expect(run.steps.planner.nodeStatus).toBe("ended");
	expect(run.plan).toBe("# plan");
});

test("concurrent sub-agents get one row each via nodeId", () => {
	const run = feed(
		blankState(),
		event({ currentNode: "blockBuilder", nodeId: "blockBuilder:t1", timestamp: 1 }),
		event({ currentNode: "blockBuilder", nodeId: "blockBuilder:t2", timestamp: 2 }),
	);
	expect(Object.keys(run.steps).sort()).toEqual([
		"blockBuilder:t1",
		"blockBuilder:t2",
	]);
});

test("a tool call updates its parent node row without completing it", () => {
	const run = feed(
		blankState(),
		event({ nodeStatus: "started", timestamp: 1 }),
		event({
			nodeStatus: "started",
			executionType: "tool",
			toolName: "search_docs",
			plainTextMessage: "Searching the documentation…",
			timestamp: 2,
		}),
		event({
			nodeStatus: "ended",
			executionType: "tool",
			toolName: "search_docs",
			plainTextMessage: "Searching the documentation — found 3 results",
			timestamp: 3,
		}),
	);
	expect(run.steps.planner.nodeStatus).not.toBe("ended");
	expect(run.steps.planner.label).toBe(
		"Searching the documentation — found 3 results",
	);
	expect(run.steps.planner.toolName).toBeUndefined();
	expect(run.isTerminal).toBe(false);
});

test("replaying the same events is a no-op", () => {
	const events = [
		event({ nodeStatus: "started", timestamp: 1 }),
		event({ nodeStatus: "ended", timestamp: 2 }),
	];
	const once = feed(blankState(), ...events);
	const twice = feed(blankState(), ...events, ...events);
	expect(twice).toEqual(once);
});

test("an older event never regresses newer state", () => {
	const run = feed(
		blankState(),
		event({ nodeStatus: "ended", timestamp: 10, runStatus: "orchestrating" }),
		event({ nodeStatus: "started", timestamp: 5, runStatus: "planning" }),
	);
	expect(run.runStatus).toBe("orchestrating");
	expect(run.steps.planner.nodeStatus).toBe("ended");
	expect(run.lastTimestamp).toBe(10);
});

test("an ended with no preceding started still creates the step", () => {
	const run = feed(
		blankState(),
		event({ nodeId: "orphan", nodeStatus: "ended", timestamp: 3 }),
	);
	expect(run.steps.orphan.nodeStatus).toBe("ended");
});

test("tasksByLevel is replaced wholesale, not merged", () => {
	const run = feed(
		blankState(),
		event({
			currentNode: "taskGenerator",
			nodeId: "taskGenerator",
			nodeStatus: "ended",
			timestamp: 1,
			payload: { node: "taskGenerator", data: { tasksByLevel: tasks("pending") } },
		}),
		event({
			currentNode: "supervisor",
			nodeId: "supervisor",
			nodeStatus: "ended",
			timestamp: 2,
			payload: { node: "supervisor", data: { tasksByLevel: tasks("completed") } },
		}),
	);
	expect(run.tasksByLevel).toHaveLength(1);
	expect(run.tasksByLevel[0]).toHaveLength(1);
	expect(run.tasksByLevel[0][0].status).toBe("completed");
});

test("only the run-level ended bookend is terminal; HITL clears on resume", () => {
	const state = blankState();
	let run = feed(
		state,
		event({
			currentNode: "humanInTheLoop",
			nodeId: "humanInTheLoop",
			nodeStatus: "running",
			timestamp: 5,
			runStatus: "awaiting_hitl",
			payload: { node: "humanInTheLoop", data: { reason: "review plan" } },
		}),
	);
	expect(run.isTerminal).toBe(false);

	run = feed(
		state,
		event({
			currentNode: "run",
			nodeId: "run",
			nodeStatus: "ended",
			timestamp: 6,
			runStatus: "awaiting_hitl",
			payload: {
				node: "run",
				data: { runStatus: "awaiting_hitl", result: "# plan" },
			},
		}),
	);
	expect(run.isTerminal).toBe(true);
	expect(run.hitl?.reason).toBe("review plan");
	expect(run.result?.result).toBe("# plan");
	// The run bookend never becomes a step row.
	expect(run.steps.run).toBeUndefined();

	run = feed(
		state,
		event({
			currentNode: "taskGenerator",
			nodeId: "taskGenerator",
			nodeStatus: "started",
			timestamp: 7,
			runStatus: "orchestrating",
		}),
	);
	expect(run.isTerminal).toBe(false);
	expect(run.hitl).toBeUndefined();
});

test("full_state merges without clobbering newer live updates, and never drops a finished run", () => {
	const state = blankState();
	// A live update raced ahead of the connect snapshot.
	feed(
		state,
		event({ nodeId: "summarizer", nodeStatus: "ended", timestamp: 100, runStatus: "completed" }),
	);

	const stale: HarnessSnapshot = {
		conversationId: CONV,
		runId: RUN,
		runStatus: "planning",
		currentNode: "planner",
		events: [event({ nodeId: "planner", nodeStatus: "started", timestamp: 50 })],
		updatedAt: 50,
	};
	applyMessage(state, { type: "full_state", conversations: [stale] });

	expect(state.runs[CONV].runStatus).toBe("completed");
	expect(state.runs[CONV].lastTimestamp).toBe(100);
	expect(Object.keys(state.runs[CONV].steps).sort()).toEqual([
		"planner",
		"summarizer",
	]);

	// Reconnect after the 60s Redis TTL: the run is gone from the snapshot but
	// must survive client-side.
	applyMessage(state, { type: "full_state", conversations: [] });
	expect(state.runs[CONV]).toBeDefined();
});
