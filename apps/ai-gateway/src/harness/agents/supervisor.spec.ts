import { describe, expect, it } from "bun:test";
import { MAX_TASK_ATTEMPTS, SupervisorAgent } from "./supervisor";
import { AgentNode, type GlobalGraphState, type Task } from "../types";

// A task assigned to an agent with no validator: a missing result is then the
// only way it can be rejected, which keeps the test off the DB-backed validators.
const task = (id: string): Task =>
	({
		id,
		title: id,
		description: id,
		status: "running",
		assignedAgentNode: AgentNode.DISCUSSION,
		dependsOnAgentId: [],
	}) as Task;

const supervise = async (tasks: Task[]) =>
	new SupervisorAgent({
		orchestratorState: {
			tasks,
			dispatchedTasks: tasks,
			subAgentResults: {},
		},
		scratchpad: [],
	} as unknown as GlobalGraphState).execute();

describe("SupervisorAgent", () => {
	it("re-queues a rejected task with the reason as feedback", async () => {
		const a = task("a");
		const result = await supervise([a]);

		expect(a.status).toBe("pending");
		expect(a.attempts).toBe(1);
		expect(a.supervisorReviews).toContain("No result");
		expect(result.scratchpad?.[0]).toContain("Retry 1/2");
	});

	it("fails the task once the attempts run out", async () => {
		const a = task("a");
		for (let i = 0; i < MAX_TASK_ATTEMPTS; i++) {
			a.status = "running";
			await supervise([a]);
		}

		expect(a.status).toBe("failed");
		expect(a.attempts).toBe(MAX_TASK_ATTEMPTS);
	});

	it("completes a task its validator accepts", async () => {
		const a = task("a");
		await new SupervisorAgent({
			orchestratorState: {
				tasks: [a],
				dispatchedTasks: [a],
				subAgentResults: { a: { ok: true } },
			},
			scratchpad: [],
		} as unknown as GlobalGraphState).execute();

		expect(a.status).toBe("completed");
		expect(a.attempts).toBeUndefined();
	});
});
