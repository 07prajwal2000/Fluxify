import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "@fluxify/common";
import type { WorkflowMetadata } from "../../ai/types";
import type { DbService } from "../internal/dbService";

export const createGetRouteDetailsTool = (dbService: DbService, metadata: WorkflowMetadata) => {
	return tool(
		async ({ routeId }) => {
			logger.info(
				`[Tools] Getting route details for routeId: ${routeId}, project: ${metadata.projectId}`,
			);
			
			const route = await dbService.getRouteDetails(metadata.projectId, routeId);
			if (!route) {
				return "Route not found.";
			}

			// We return JSON stringified to prevent crashing LLM with huge objects
			return JSON.stringify(route, null, 2);
		},
		{
			name: "get_route_details",
			description:
				"Get the exact configuration details (method, path, schemas) of an existing route.",
			schema: z.object({
				routeId: z.string().describe("The UUID of the route to fetch details for.")
			}),
		},
	);
};
