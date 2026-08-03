import { describe, expect, it } from "bun:test";
import { HarnessCallbacks } from "./callbacks";
import { AgentNode } from "./types";
import type { HarnessStreamEvent } from "./streamTypes";
import type { HarnessService } from "./internal/harnessService";
import type { RedisService } from "./internal/redisService";

/** Collects every event the callbacks emit, in order. */
function harness() {
	const events: HarnessStreamEvent[] = [];
	const liveStateSaves: any[] = [];
	const callbacks = new HarnessCallbacks({
		state: {},
		conversationId: "conv-1",
		runId: "run-1",
		userId: null, // skips the NATS publish
		harnessService: {
			upsertStep: async () => ({ id: "step-1" }),
			saveLiveState: async (input: any) => {
				liveStateSaves.push(input);
			},
		} as unknown as HarnessService,
		redisService: {
			appendEvent: async (event: HarnessStreamEvent) => {
				events.push(event);
			},
		} as unknown as RedisService,
	});
	return { callbacks, events, liveStateSaves };
}

describe("harness event contract", () => {
	it("emits started/ended around a node, keyed by nodeId", async () => {
		const { callbacks, events } = harness();

		await callbacks.onBefore(AgentNode.PLANNER, { input: {} });
		await callbacks.onAfter(AgentNode.PLANNER, {
			output: { plannerState: { markdownPlan: "# plan" } },
		});
		await callbacks.flush();

		expect(events.map((e) => e.nodeStatus)).toEqual(["started", "ended"]);
		for (const event of events) {
			expect(event.currentNode).toBe(AgentNode.PLANNER);
			expect(event.nodeId).toBe(AgentNode.PLANNER);
			expect(event.executionType).toBe("agent");
			expect(event.plainTextMessage.length).toBeGreaterThan(0);
			expect(event.runStatus).toBe("planning");
			expect(event.level).toBe("harness");
		}
		expect(events[1].payload).toEqual({
			node: AgentNode.PLANNER,
			data: { markdownPlan: "# plan" },
		});
	});

	it("scopes a sub-agent's nodeId to its task so concurrent runs don't collide", async () => {
		const { callbacks, events } = harness();
		const task = { id: "t-7", title: "T", status: "running" } as any;

		await callbacks.onBefore(AgentNode.BLOCK_BUILDER, {
			input: { activeTask: task },
		});
		await callbacks.flush();

		expect(events[0].nodeId).toBe("blockBuilder:t-7");
		expect(events[0].level).toBe("sub_agent");
		expect(events[0].runStatus).toBe("executing");
	});

	it("turns a tool_call custom event into a tool event on the parent nodeId", async () => {
		const { callbacks, events } = harness();

		await callbacks.onCustomEvent("tool_call", {
			agent: AgentNode.BLOCK_BUILDER,
			agentId: "t-7",
			tool: "find_resource",
			status: "started",
		});
		await callbacks.onCustomEvent("tool_call", {
			agent: AgentNode.BLOCK_BUILDER,
			agentId: "t-7",
			tool: "find_resource",
			status: "ended",
			summary: "3 routes",
		});
		await callbacks.flush();

		expect(events).toHaveLength(2);
		for (const event of events) {
			expect(event.executionType).toBe("tool");
			expect(event.toolName).toBe("find_resource");
			// Same key as the node that requested it — the UI nests, not creates.
			expect(event.nodeId).toBe("blockBuilder:t-7");
		}
		expect(events[0].nodeStatus).toBe("started");
		expect(events[1].nodeStatus).toBe("ended");
		expect(events[1].plainTextMessage).toContain("3 routes");
	});

	it("emits agent progress as a running event with the agent's own wording", async () => {
		const { callbacks, events } = harness();

		await callbacks.onCustomEvent("agent_status", {
			agent: AgentNode.ROUTER,
			status: "routing query",
		});
		await callbacks.flush();

		expect(events[0]).toMatchObject({
			currentNode: AgentNode.ROUTER,
			nodeId: AgentNode.ROUTER,
			nodeStatus: "running",
			executionType: "agent",
			plainTextMessage: "routing query",
		});
	});

	it("saves live state once per node end, and only for nodes a resume reads", async () => {
		// The snapshot carries every canvas the run has produced, so writing it on
		// both ends of all ~20 nodes was load nobody read back.
		const { callbacks, liveStateSaves } = harness();
		const task = { id: "t-7", title: "T", status: "running" } as any;

		await callbacks.onBefore(AgentNode.PLANNER, { input: {} });
		await callbacks.onAfter(AgentNode.PLANNER, { output: {} });
		await callbacks.onBefore(AgentNode.BLOCK_BUILDER, {
			input: { activeTask: task },
		});
		await callbacks.onAfter(AgentNode.BLOCK_BUILDER, {
			input: { activeTask: task },
			output: {},
		});

		expect(liveStateSaves).toHaveLength(1);
		expect(liveStateSaves[0]).toMatchObject({
			runId: "run-1",
			currentState: "running",
		});
	});

	it("ignores events from things that are not graph nodes", async () => {
		const { callbacks, events } = harness();

		await callbacks.onBefore("ChannelWrite" as any, { input: {} });
		await callbacks.onCustomEvent("tool_call", {
			agent: "",
			tool: "find_resource",
			status: "started",
		});
		await callbacks.flush();

		expect(events).toHaveLength(0);
	});
});
