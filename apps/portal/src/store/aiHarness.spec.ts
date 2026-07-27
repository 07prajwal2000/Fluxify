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
		phase: "node_start",
		node: "planner",
		status: "Running planner",
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
			stepId: e.stepId,
			event: e,
		});
	}
	return state.runs[CONV] as ConversationUIState;
}

const tasks = (status: HarnessTaskView["status"]): HarnessTaskView[][] => [
	[{ id: "t1", title: "T1", status, assignedAgentNode: "blockBuilder", level: 0 }],
];

test("node_start/node_end upsert one step by stepId", () => {
	const run = feed(
		blankState(),
		event({ stepId: "s1", phase: "node_start", timestamp: 1 }),
		event({
			stepId: "s1",
			phase: "node_end",
			timestamp: 2,
			payload: { node: "planner", data: { markdownPlan: "# plan" } },
		}),
	);
	expect(Object.keys(run.steps)).toEqual(["s1"]);
	expect(run.steps.s1.status).toBe("completed");
	expect(run.plan).toBe("# plan");
});

test("replaying the same events is a no-op", () => {
	const events = [
		event({ stepId: "s1", phase: "node_start", timestamp: 1 }),
		event({ stepId: "s1", phase: "node_end", timestamp: 2 }),
	];
	const once = feed(blankState(), ...events);
	const twice = feed(blankState(), ...events, ...events);
	expect(twice).toEqual(once);
});

test("an older event never regresses newer state", () => {
	const run = feed(
		blankState(),
		event({ stepId: "s1", phase: "node_end", timestamp: 10, runStatus: "orchestrating" }),
		event({ stepId: "s1", phase: "node_start", timestamp: 5, runStatus: "planning" }),
	);
	expect(run.runStatus).toBe("orchestrating");
	expect(run.steps.s1.status).toBe("completed");
	expect(run.lastTimestamp).toBe(10);
});

test("node_end with no preceding node_start still creates the step", () => {
	const run = feed(
		blankState(),
		event({ stepId: "orphan", phase: "node_end", timestamp: 3 }),
	);
	expect(run.steps.orphan.status).toBe("completed");
});

test("tasksByLevel is replaced wholesale, not merged", () => {
	const run = feed(
		blankState(),
		event({
			node: "taskGenerator",
			phase: "node_end",
			timestamp: 1,
			payload: { node: "taskGenerator", data: { tasksByLevel: tasks("pending") } },
		}),
		event({
			node: "supervisor",
			phase: "node_end",
			timestamp: 2,
			payload: { node: "supervisor", data: { tasksByLevel: tasks("completed") } },
		}),
	);
	expect(run.tasksByLevel).toHaveLength(1);
	expect(run.tasksByLevel[0]).toHaveLength(1);
	expect(run.tasksByLevel[0][0].status).toBe("completed");
});

test("terminal is a status event with a terminal runStatus; HITL clears on resume", () => {
	const state = blankState();
	let run = feed(
		state,
		event({
			node: "humanInTheLoop",
			phase: "hitl_required",
			timestamp: 5,
			runStatus: "awaiting_hitl",
			payload: { node: "humanInTheLoop", data: { reason: "review plan" } },
		}),
		event({
			node: "humanInTheLoop",
			phase: "status",
			timestamp: 6,
			runStatus: "awaiting_hitl",
		}),
	);
	expect(run.isTerminal).toBe(true);
	expect(run.hitl?.reason).toBe("review plan");

	run = feed(
		state,
		event({ node: "taskGenerator", phase: "node_start", timestamp: 7, runStatus: "orchestrating" }),
	);
	expect(run.isTerminal).toBe(false);
	expect(run.hitl).toBeUndefined();
});

test("full_state merges without clobbering newer live updates, and never drops a finished run", () => {
	const state = blankState();
	// A live update raced ahead of the connect snapshot.
	feed(state, event({ stepId: "s2", phase: "node_end", timestamp: 100, runStatus: "completed" }));

	const stale: HarnessSnapshot = {
		conversationId: CONV,
		runId: RUN,
		runStatus: "planning",
		currentNode: "planner",
		events: [event({ stepId: "s1", phase: "node_start", timestamp: 50 })],
		updatedAt: 50,
	};
	applyMessage(state, { type: "full_state", conversations: [stale] });

	expect(state.runs[CONV].runStatus).toBe("completed");
	expect(state.runs[CONV].lastTimestamp).toBe(100);
	expect(Object.keys(state.runs[CONV].steps).sort()).toEqual(["s1", "s2"]);

	// Reconnect after the 60s Redis TTL: the run is gone from the snapshot but
	// must survive client-side.
	applyMessage(state, { type: "full_state", conversations: [] });
	expect(state.runs[CONV]).toBeDefined();
});
