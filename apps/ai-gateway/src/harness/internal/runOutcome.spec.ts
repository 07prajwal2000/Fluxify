import { describe, expect, it } from "bun:test";
import { RunOutcomeWriter } from "./runOutcome";
import { RunBudget } from "../models/budget";
import { AgentNode, type GlobalGraphState } from "../types";
import type { AgentFactory } from "../models/factory";
import type { HarnessService } from "./harnessService";
import type { RedisService } from "./redisService";
import type { HarnessRunContext } from "./runContext";
import type { HarnessStreamEvent } from "../streamTypes";

type Recorded = {
	runs: Record<string, unknown>[];
	liveStates: Record<string, unknown>[];
	conversation: (string | null)[];
	events: HarnessStreamEvent[];
	clearedActiveRun: number;
	finalizedSnapshots: number;
};

function writerWith(): { writer: RunOutcomeWriter; recorded: Recorded } {
	const recorded: Recorded = {
		runs: [],
		liveStates: [],
		conversation: [],
		events: [],
		clearedActiveRun: 0,
		finalizedSnapshots: 0,
	};
	const harnessService = {
		updateRun: async (input: Record<string, unknown>) => {
			recorded.runs.push(input);
		},
		saveLiveState: async (input: Record<string, unknown>) => {
			recorded.liveStates.push(input);
		},
		updateConversationStatus: async (status: string) => {
			recorded.conversation.push(status);
		},
		// No eligible block, so compaction is a no-op and never reaches a model.
		getEligibleHistoryCompactionBlock: async () => null,
	} as unknown as HarnessService;
	const redisService = {
		appendEvent: async (event: HarnessStreamEvent) => {
			recorded.events.push(event);
		},
		clearActiveRun: async () => {
			recorded.clearedActiveRun++;
		},
		finalizeSnapshot: async () => {
			recorded.finalizedSnapshots++;
		},
	} as unknown as RedisService;
	const ctx: HarnessRunContext = { conversationId: "conv-1", runId: "run-1" };

	return {
		recorded,
		// userId null: publishing is skipped, the redis event log still records.
		writer: new RunOutcomeWriter(
			ctx,
			harnessService,
			null,
			redisService,
			{} as AgentFactory,
		),
	};
}

const finalize = async (finalState: Partial<GlobalGraphState>) => {
	const { writer, recorded } = writerWith();
	await writer.finalize(new RunBudget(), 0, finalState);
	return recorded;
};

describe("RunOutcomeWriter.finalize", () => {
	it("completes a summarized build", async () => {
		const recorded = await finalize({
			summarizerState: { markdown: "Built it." },
			orchestratorState: { tasks: [{ status: "completed" }] },
		} as Partial<GlobalGraphState>);

		expect(recorded.runs[0]!.status).toBe("completed");
		expect(recorded.runs[0]!.aiResponse).toBe("Built it.");
		expect(recorded.conversation).toEqual(["completed"]);
		expect(recorded.events.at(-1)!.plainTextMessage).toBe("All done");
		expect(recorded.clearedActiveRun).toBe(1);
		expect(recorded.finalizedSnapshots).toBe(1);
	});

	// The summary still ships — it names what did and didn't get built — but the
	// run must not report success over a route that was never configured.
	it("fails a build whose tasks did not all land", async () => {
		const recorded = await finalize({
			summarizerState: { markdown: "Partially built." },
			orchestratorState: {
				tasks: [
					{ status: "completed", title: "Configure route" },
					{ status: "failed", title: "Build canvas" },
				],
			},
		} as Partial<GlobalGraphState>);

		expect(recorded.runs[0]!.status).toBe("failed");
		expect(recorded.runs[0]!.aiResponse).toBe("Partially built.");
		const ended = recorded.events.at(-1)!;
		expect(ended.plainTextMessage).toBe("Finished with 1 unfinished task");
		expect(ended.payload?.data).toMatchObject({ error: "Build canvas" });
	});

	// Without this tail an unbuildable request completes silently and the user
	// never learns why.
	it("falls back to the router's rejection when nothing else spoke", async () => {
		const recorded = await finalize({
			routerState: { rejectReason: "Fluxify cannot serve WebSockets." },
		} as Partial<GlobalGraphState>);

		expect(recorded.runs[0]!.aiResponse).toBe(
			"Fluxify cannot serve WebSockets.",
		);
		expect(recorded.runs[0]!.status).toBe("completed");
	});

	it("parks a plan awaiting review instead of completing it", async () => {
		const recorded = await finalize({
			currentAgent: AgentNode.HUMAN_IN_THE_LOOP,
			plannerState: { markdownPlan: "## Plan" },
		} as Partial<GlobalGraphState>);

		expect(recorded.runs[0]!.status).toBe("awaiting_hitl");
		expect(recorded.runs[0]!.aiResponse).toBe("## Plan");
		expect(recorded.liveStates[0]!.currentState).toBe("paused_hitl");
		expect(recorded.conversation).toEqual(["paused_hitl"]);
		// The run is parked, not over: the conversation keeps its active run.
		expect(recorded.clearedActiveRun).toBe(0);
	});
});

describe("RunOutcomeWriter terminal paths", () => {
	// Erasing this made every failure a full restart from the planner.
	it("keeps what a failed run built", async () => {
		const { writer, recorded } = writerWith();
		const graphState = {
			orchestratorState: { tasks: [{ status: "completed" }] },
		} as Partial<GlobalGraphState>;

		await writer.fail(
			new Error("provider exploded"),
			"The model could not be reached.",
			AgentNode.BLOCK_BUILDER,
			new RunBudget(),
			2,
			graphState,
		);

		expect(recorded.runs[0]!.status).toBe("failed");
		expect(recorded.liveStates[0]!.graphState).toBe(graphState);
		expect(recorded.conversation).toEqual(["failed"]);
		expect(recorded.events.at(-1)!.payload?.data).toMatchObject({
			error: "provider exploded",
		});
	});

	it("keeps what an interrupted run built", async () => {
		const { writer, recorded } = writerWith();
		const graphState = { userQuery: "build it" } as Partial<GlobalGraphState>;

		await writer.interrupt(new RunBudget(), 0, graphState);

		expect(recorded.runs[0]!.status).toBe("interrupted");
		expect(recorded.liveStates[0]!.graphState).toBe(graphState);
		expect(recorded.conversation).toEqual(["interrupted"]);
	});

	it("completes a rejected plan without implementing it", async () => {
		const { writer, recorded } = writerWith();

		await writer.reject({ type: "reject", message: "wrong route" });

		expect(recorded.runs[0]!.status).toBe("completed");
		expect(recorded.runs[0]!.aiResponse).toContain("Reason: wrong route");
		// Nothing ran, so there is no graph state worth keeping.
		expect(recorded.liveStates[0]!.workingMemory).toEqual({});
		expect(recorded.events[0]!.plainTextMessage).toBe("Discarding the plan");
	});
});
