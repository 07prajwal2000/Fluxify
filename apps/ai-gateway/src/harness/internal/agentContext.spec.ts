import { describe, expect, it } from "bun:test";
import { buildAgentContext } from "./agentContext";
import { AgentNode, type Task } from "../types";

const task = (dependsOnAgentId: string[]): Task => ({
	id: "build-1",
	title: "Build profiles route",
	description: "Create the canvas.",
	dependsOnAgentId,
	status: "running",
	assignedAgentNode: AgentNode.BLOCK_BUILDER,
});

describe("buildAgentContext", () => {
	it("preloads relevant inventory and direct outputs without a tool round trip", () => {
		const context = buildAgentContext({
			currentContext: "## Current context\nexisting route",
			projectInventory: [
				{
					type: "integration",
					id: "integration-1",
					identifier: "postgres:neon",
					label: "Profiles DB",
				},
			],
			activeTask: task(["route-1", "route-1"]),
			subAgentResults: {
				"route-1": {
					action: "create",
					routeId: "new-route-1",
					data: { method: "GET", path: "/profiles" },
				},
			},
			targetCanvas: "## Target canvas\ntargetId: new-route-1",
		});

		expect(context).toContain("Relevant project inventory");
		expect(context).toContain("Profiles DB");
		expect(context).toContain("Direct task dependencies");
		expect(context).toContain('"taskId":"route-1"');
		expect(context).toContain("do NOT call get_agent_output");
		// The resolved target sits above the inventory, so the agent reads what it
		// is editing before the catalogue of everything it is not.
		expect(context!.indexOf("Target canvas")).toBeLessThan(
			context!.indexOf("Relevant project inventory"),
		);
	});

	it("omits sections the caller could not resolve", () => {
		const context = buildAgentContext({
			activeTask: task(["route-1"]),
			subAgentResults: {
				"route-1": { action: "update-partial", routeId: "route-1" },
			},
		});

		expect(context).toContain("Direct task dependencies");
		expect(context).not.toContain("Target canvas");
		expect(context).not.toContain("Relevant project inventory");
	});
});
