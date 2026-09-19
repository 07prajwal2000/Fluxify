import { logger } from "@fluxify/common";
import { z } from "zod";
import type { DbService } from "../internal/dbService";
import type { WorkflowMetadata } from "../types";
import { fencedTool } from "./fenced";

export const createGetRouteDetailsTool = (dbService: DbService, metadata: WorkflowMetadata) => {
	return fencedTool(
		async ({ routeId }) => {
			logger.info(
				`[Tools] Getting route details for routeId: ${routeId}, project: ${metadata.projectId}`,
			);

			const route = await dbService.getRouteDetails(metadata.projectId, routeId);
			if (!route) {
				return "Route not found.";
			}

			// Project only what the tool description promises. The raw row also
			// carries projectId, createdBy and timestamps — tokens the model pays
			// for on every re-send and can do nothing with.
			return JSON.stringify({
				id: route.id,
				name: route.name,
				method: route.method,
				path: route.path,
				active: route.active,
				bodySchema: route.bodySchema,
				querySchema: route.querySchema,
				paramsSchema: route.paramsSchema,
			});
		},
		{
			name: "get_route_details",
			description:
				"Get the exact configuration details (method, path, schemas) of an existing route.",
			schema: z.object({
				routeId: z.string().describe("The UUID of the route to fetch details for."),
			}),
		},
	);
};
