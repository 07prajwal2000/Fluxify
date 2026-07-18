import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "@fluxify/common";
import type { WorkflowMetadata } from "../../ai/types";
import type { DbService } from "../internal/dbService";
import type { ResourceType } from "../../workflow/nodes/builder/types";

export const createFindResourceTool = (
	dbService: DbService,
	metadata: WorkflowMetadata,
) => {
	return tool(
		async ({ searchQuery, resourceType }) => {
			logger.info(
				`[Tools] Searching ${resourceType} for '${searchQuery}' in project ${metadata.projectId}`,
			);

			switch (resourceType as ResourceType) {
				case "route":
					return await dbService.findRoutes(metadata.projectId, searchQuery);
				case "app_config":
					return await dbService.findAppConfigs(
						metadata.projectId,
						searchQuery,
					);
				case "integration":
					return await dbService.findIntegrations(
						metadata.projectId,
						searchQuery,
					);
				case "custom_block":
					return await dbService.findCustomBlocks(
						metadata.projectId,
						searchQuery,
					);
				default:
					return [];
			}
		},
		{
			name: "find_resource",
			description:
				"Search the production database for existing resources (routes, app configs, integrations, custom blocks) in the user's project.",
			schema: z.object({
				searchQuery: z
					.string()
					.describe("The name, path, or description keyword to search for."),
				resourceType: z
					.enum(["route", "app_config", "integration", "custom_block"])
					.describe("The type of resource to search for."),
			}),
		},
	);
};
