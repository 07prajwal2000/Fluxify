import { describe, expect, it } from "bun:test";
import { AgentNode, mergeOrchestratorState, type Task } from "./types";

const task = (id: string) =>
	({
		id,
		title: id,
		description: id,
		dependsOnAgentId: [],
		status: "running",
		assignedAgentNode: AgentNode.BLOCK_BUILDER,
	}) as Task;

describe("mergeOrchestratorState", () => {
	it("preserves results from concurrent sub-agent updates", () => {
		const current = { tasks: [task("a"), task("b")] };
		const afterA = mergeOrchestratorState(current, {
			subAgentResults: { a: { blocks: [] } },
		});
		const afterB = mergeOrchestratorState(afterA, {
			subAgentResults: { b: { blocks: [] } },
		});

		expect(afterB.subAgentResults).toEqual({
			a: { blocks: [] },
			b: { blocks: [] },
		});
	});
});
