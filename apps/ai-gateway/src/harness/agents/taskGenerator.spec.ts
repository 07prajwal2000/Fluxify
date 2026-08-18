import { describe, expect, it } from "bun:test";
import { sanitizeTasks } from "./taskGenerator";
import { AgentNode } from "../types";

type RawTask = Parameters<typeof sanitizeTasks>[0][number];

function raw(overrides: Partial<RawTask> = {}): RawTask {
	return {
		id: "abc12",
		title: "Build the route",
		description: "…",
		dependsOnAgentId: [],
		assignedAgentNode: AgentNode.ROUTE_CONFIG_AGENT,
		...overrides,
	};
}

describe("sanitizeTasks", () => {
	it("keeps a well-formed task untouched", () => {
		const { tasks, notes } = sanitizeTasks([raw()]);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]!.id).toBe("abc12");
		expect(tasks[0]!.assignedAgentNode).toBe(AgentNode.ROUTE_CONFIG_AGENT);
		expect(tasks[0]!.status).toBe("pending");
		expect(notes).toEqual([]);
	});

	it("drops a task assigned to a node that is not a sub-agent", () => {
		const { tasks, notes } = sanitizeTasks([
			raw({ id: "aaa11", assignedAgentNode: "databaseAgent" }),
			raw({ id: "bbb22" }),
		]);
		expect(tasks.map((t) => t.id)).toEqual(["bbb22"]);
		expect(notes[0]).toContain("databaseAgent");
	});

	it("drops a task pointed at a control-plane node, which would loop the graph", () => {
		// `new Send(AgentNode.ORCHESTRATOR)` re-enters the orchestrator and
		// re-dispatches until recursionLimit — the expensive failure.
		const { tasks } = sanitizeTasks([
			raw({ assignedAgentNode: AgentNode.ORCHESTRATOR }),
			raw({ id: "ccc33", assignedAgentNode: AgentNode.PLANNER }),
		]);
		expect(tasks).toEqual([]);
	});

	it("matches node names case-insensitively", () => {
		const { tasks, notes } = sanitizeTasks([
			raw({ assignedAgentNode: " BlockBuilder " }),
		]);
		expect(tasks[0]!.assignedAgentNode).toBe(AgentNode.BLOCK_BUILDER);
		expect(notes).toEqual([]);
	});

	it("accepts the custom block config agent", () => {
		const { tasks } = sanitizeTasks([
			raw({ assignedAgentNode: AgentNode.CUSTOM_BLOCK_CONFIG_AGENT }),
		]);
		expect(tasks[0]!.assignedAgentNode).toBe(AgentNode.CUSTOM_BLOCK_CONFIG_AGENT);
	});

	it("re-keys duplicate ids so every task still runs", () => {
		const { tasks, notes } = sanitizeTasks([
			raw({ id: "dup01", title: "first" }),
			raw({ id: "dup01", title: "second" }),
		]);
		expect(tasks).toHaveLength(2);
		expect(tasks[0]!.id).toBe("dup01");
		expect(tasks[1]!.id).not.toBe("dup01");
		expect(notes[0]).toContain("duplicate");
	});

	it("removes a dependency on a task that does not exist", () => {
		const { tasks, notes } = sanitizeTasks([
			raw({ id: "aaa11", dependsOnAgentId: ["ghost1"] }),
		]);
		expect(tasks[0]!.dependsOnAgentId).toEqual([]);
		expect(notes[0]).toContain("ghost1");
	});

	it("removes a dependency on a task that was dropped", () => {
		const { tasks } = sanitizeTasks([
			raw({ id: "aaa11", assignedAgentNode: "nope" }),
			raw({ id: "bbb22", dependsOnAgentId: ["aaa11"] }),
		]);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]!.dependsOnAgentId).toEqual([]);
	});

	it("removes a self-dependency", () => {
		const { tasks } = sanitizeTasks([
			raw({ id: "aaa11", dependsOnAgentId: ["aaa11"] }),
		]);
		expect(tasks[0]!.dependsOnAgentId).toEqual([]);
	});

	it("keeps a real dependency edge", () => {
		const { tasks, notes } = sanitizeTasks([
			raw({ id: "aaa11" }),
			// a different agent, so the same-agent chain merge leaves the edge alone
			raw({
				id: "bbb22",
				dependsOnAgentId: ["aaa11"],
				assignedAgentNode: AgentNode.BLOCK_BUILDER,
			}),
		]);
		expect(tasks[1]!.dependsOnAgentId).toEqual(["aaa11"]);
		expect(notes).toEqual([]);
	});
});

describe("sanitizeTasks — chained same-agent tasks", () => {
	const chain = (): RawTask[] => [
		raw({ id: "JWT01", title: "Add block", assignedAgentNode: AgentNode.BLOCK_BUILDER }),
		raw({
			id: "JWT02",
			title: "Configure block",
			dependsOnAgentId: ["JWT01"],
			assignedAgentNode: AgentNode.BLOCK_BUILDER,
		}),
		raw({
			id: "JWT03",
			title: "Return it in the response",
			dependsOnAgentId: ["JWT02"],
			assignedAgentNode: AgentNode.BLOCK_BUILDER,
		}),
	];

	it("collapses one canvas edit split across three builder runs", () => {
		const { tasks, notes } = sanitizeTasks(chain());
		expect(tasks.map((t) => t.id)).toEqual(["JWT01"]);
		expect(tasks[0]!.description).toContain("Configure block");
		expect(tasks[0]!.description).toContain("Return it in the response");
		expect(notes).toHaveLength(2);
	});

	it("re-points a later task at the merged one", () => {
		const { tasks } = sanitizeTasks([
			...chain().slice(0, 2),
			raw({
				id: "SUM01",
				dependsOnAgentId: ["JWT02"],
				assignedAgentNode: AgentNode.ROUTE_CONFIG_AGENT,
			}),
		]);
		expect(tasks.map((t) => t.id)).toEqual(["JWT01", "SUM01"]);
		expect(tasks[1]!.dependsOnAgentId).toEqual(["JWT01"]);
	});

	it("leaves independent same-agent tasks alone", () => {
		const { tasks } = sanitizeTasks([
			raw({ id: "aaa11", assignedAgentNode: AgentNode.BLOCK_BUILDER }),
			raw({ id: "bbb22", assignedAgentNode: AgentNode.BLOCK_BUILDER }),
		]);
		expect(tasks).toHaveLength(2);
	});

	it("does not merge across different agents", () => {
		const { tasks } = sanitizeTasks([
			raw({ id: "aaa11", assignedAgentNode: AgentNode.CUSTOM_BLOCK_CONFIG_AGENT }),
			raw({
				id: "bbb22",
				dependsOnAgentId: ["aaa11"],
				assignedAgentNode: AgentNode.BLOCK_BUILDER,
			}),
		]);
		expect(tasks).toHaveLength(2);
	});
});
