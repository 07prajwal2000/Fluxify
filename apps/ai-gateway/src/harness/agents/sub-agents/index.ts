import type { SubAgentMetadata } from "./types";
import { AgentNode } from "../../types";
export * from "./routeConfig";
export * from "./blockBuilder";

export const subAgents: SubAgentMetadata[] = [
	{
		name: "Route Config Agent",
		nodeName: AgentNode.ROUTE_CONFIG_AGENT,
		ability: "Create, modify, or delete route configurations and schemas",
		description:
			"Responsible for configuring routes, including their method, path, and request validation schemas (body, query, params) based on custom schema definitions. Note: Tasks assigned to this agent MUST include the 'routeId' in the task description if the intent is to update or delete an existing route, so it can search for the route.",
	},
	{
		name: "Block Builder Agent",
		nodeName: AgentNode.BUILDER,
		ability: "Create, modify, or delete canvas blocks and edge connections for routes or custom blocks",
		description:
			"Responsible for building and modifying the canvas of a workflow DAG by configuring individual blocks and connecting them. This agent is capable of building both for a custom block or a route. The input task should clearly define where the canvas needs to be edited. If the canvas needs to be set up for a new route/custom block which wasn't created in the DB but is listed in a previous agent's output, the task description MUST include the previous agent's task ID. The builder will use its tools to fetch this output. Because of this, large configuration details should not be exposed to the user and should be stored in just the scratchpad and passed via task IDs.",
	},
];
