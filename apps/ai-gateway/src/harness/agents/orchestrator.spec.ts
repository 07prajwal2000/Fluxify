import { describe, expect, it } from "bun:test";
import { OrchestratorAgent } from "./orchestrator";
import { AgentNode, type GlobalGraphState, type Task } from "../types";

const task = (id: string, dependsOnAgentId: string[] = []): Task =>
	({
		id,
		title: id,
		description: id,
		status: "pending",
		assignedAgentNode: AgentNode.BLOCK_BUILDER,
		dependsOnAgentId,
	}) as Task;

const stateWith = (tasks: Task[]) =>
	({ orchestratorState: { tasks } }) as unknown as GlobalGraphState;

const dispatch = async (tasks: Task[]) => {
	const result = await new OrchestratorAgent(stateWith(tasks)).execute();
	return result.orchestratorState?.dispatchedTasks ?? [];
};

describe("OrchestratorAgent", () => {
	it("dispatches only tasks whose dependencies are settled", async () => {
		const tasks = [task("a"), task("b", ["a"]), task("c")];
		const dispatched = await dispatch(tasks);
		expect(dispatched.map((t) => t.id)).toEqual(["a", "c"]);
	});

	it("dispatches dependents once their parent is done", async () => {
		const a = task("a");
		a.status = "completed";
		const dispatched = await dispatch([a, task("b", ["a"])]);
		expect(dispatched.map((t) => t.id)).toEqual(["b"]);
	});

	it("never re-dispatches a task that is already running", async () => {
		const tasks = [task("a"), task("b")];
		expect((await dispatch(tasks)).map((t) => t.id)).toEqual(["a", "b"]);
		// Tasks are now `running`; a second pass must not fan them out again.
		expect(await dispatch(tasks)).toEqual([]);
	});

	it("resumes the level whose results the supervisor settled", async () => {
		const a = task("a");
		const b = task("b", ["a"]);
		await dispatch([a, b]); // a -> running
		a.status = "completed"; // supervisor verdict
		expect((await dispatch([a, b])).map((t) => t.id)).toEqual(["b"]);
	});

	it("fails dependents of a failed task instead of dispatching them", async () => {
		const a = task("a");
		a.status = "failed";
		const b = task("b", ["a"]);
		const c = task("c", ["b"]); // transitive

		expect(await dispatch([a, b, c])).toEqual([]);
		expect([b.status, c.status]).toEqual(["failed", "failed"]);
		expect(b.supervisorReviews).toContain("a");
	});

	it("still dispatches siblings of a failed task", async () => {
		const a = task("a");
		a.status = "failed";
		const dispatched = await dispatch([a, task("b", ["a"]), task("c")]);
		expect(dispatched.map((t) => t.id)).toEqual(["c"]);
	});

	it("ends the run when nothing is left to dispatch", async () => {
		const done = task("a");
		done.status = "completed";
		const failed = task("b");
		failed.status = "failed";

		const result = await new OrchestratorAgent(
			stateWith([done, failed]),
		).execute();
		expect(result.nextRoute).toBeUndefined();
		expect(result.orchestratorState?.dispatchedTasks).toEqual([]);
	});
});
