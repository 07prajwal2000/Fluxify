import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "@fluxify/common";
import type { WorkflowMetadata } from "../../ai/types";

export const createGetRouteDetailsTool = (metadata: WorkflowMetadata) => {
	return tool(
		async () => {
			logger.info(
				`[Tools] Getting route details for routeId: ${metadata.routeId}, project: ${metadata.projectId}, location: ${metadata.location}`,
			);
			// Return dummy empty object stringified
			return Promise.resolve("{}");
		},
		{
			name: "get_route_details",
			description:
				"Get the details of the user's current route information based on their browser location.",
			schema: z.object({}),
		},
	);
};
