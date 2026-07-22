import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { SubAgentResult } from "../types";

export const createGetAgentOutputTool = (
	subAgentResults: Record<string, SubAgentResult> = {},
) => {
	return tool(
		async ({ taskIds }) => {
			const results: Record<string, SubAgentResult> = {};
			for (const id of taskIds) {
				if (subAgentResults[id]) {
					results[id] = subAgentResults[id];
				}
			}
			return JSON.stringify(results, null, 2);
		},
		{
			name: "get_agent_output",
			description:
				"Fetches the output of previous agents by their task ID. Use this to get details about a new route or custom block that hasn't been saved to the database yet, but was configured by a prior agent. The planner passes these task IDs in the task description.",
			schema: z.object({
				taskIds: z
					.array(z.string())
					.describe("Array of task IDs to fetch outputs for."),
			}),
		},
	);
};
