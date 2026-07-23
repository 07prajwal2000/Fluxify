import { tool } from "ai";
import { z } from "zod";
import {
	db,
	routesEntity,
	appConfigEntity,
	integrationsEntity,
	customBlocksListEntity,
} from "@fluxify/server";
import { eq, ilike, or, and } from "drizzle-orm";
import { logger } from "@fluxify/common";
import type { WorkflowMetadata } from "../../ai/types";
import type { FindResourceResult, ResourceType } from "../nodes/builder/types";

export function createFindResourceTool(metadata: WorkflowMetadata) {
	return tool({
		description:
			"Search the production database for existing resources (routes, app configs, integrations, custom blocks) in the user's project.",
		inputSchema: z.object({
			searchQuery: z.string().describe("The name, path, or description keyword to search for."),
			resourceType: z
				.enum(["route", "app_config", "integration", "custom_block"])
				.describe("The type of resource to search for."),
		}),
		execute: async ({ searchQuery, resourceType }): Promise<FindResourceResult[]> => {
			logger.info(
				`[Tools] Searching ${resourceType} for '${searchQuery}' in project ${metadata.projectId}`,
			);

			try {
				switch (resourceType as ResourceType) {
					case "route": {
						const routes = await db
							.select({
								id: routesEntity.id,
								name: routesEntity.name,
								path: routesEntity.path,
								method: routesEntity.method,
							})
							.from(routesEntity)
							.where(
								and(
									eq(routesEntity.projectId, metadata.projectId),
									or(
										ilike(routesEntity.name, `%${searchQuery}%`),
										ilike(routesEntity.path, `%${searchQuery}%`),
									),
								),
							)
							.limit(10);
						return routes.map((r) => ({
							type: "route",
							id: r.id,
							name: r.name || "",
							path: r.path || "",
							method: r.method || "",
						}));
					}
					case "app_config": {
						const configs = await db
							.select({
								id: appConfigEntity.id,
								name: appConfigEntity.keyName,
								description: appConfigEntity.description,
							})
							.from(appConfigEntity)
							.where(
								and(
									eq(appConfigEntity.projectId, metadata.projectId),
									or(
										ilike(appConfigEntity.keyName, `%${searchQuery}%`),
										ilike(appConfigEntity.description, `%${searchQuery}%`),
									),
								),
							)
							.limit(10);
						return configs.map((c) => ({
							type: "app_config",
							id: c.id.toString(),
							name: c.name || "",
							description: c.description || "",
						}));
					}
					case "integration": {
						const integrations = await db
							.select({
								id: integrationsEntity.id,
								name: integrationsEntity.name,
								group: integrationsEntity.group,
								variant: integrationsEntity.variant,
							})
							.from(integrationsEntity)
							.where(
								and(
									eq(integrationsEntity.projectId, metadata.projectId),
									ilike(integrationsEntity.name, `%${searchQuery}%`),
								),
							)
							.limit(10);
						return integrations.map((i) => ({
							type: "integration",
							id: i.id,
							name: i.name || "",
							group: i.group || "",
							variant: i.variant || "",
						}));
					}
					case "custom_block": {
						const customBlocks = await db
							.select({
								id: customBlocksListEntity.id,
								name: customBlocksListEntity.name,
								description: customBlocksListEntity.description,
							})
							.from(customBlocksListEntity)
							.where(
								and(
									or(
										eq(customBlocksListEntity.projectId, metadata.projectId),
										eq(customBlocksListEntity.sourceType, "inhouse"),
									),
									or(
										ilike(customBlocksListEntity.name, `%${searchQuery}%`),
										ilike(customBlocksListEntity.label, `%${searchQuery}%`),
									),
								),
							)
							.limit(10);
						return customBlocks.map((c) => ({
							type: "custom_block",
							id: c.id,
							name: c.name,
							description: c.description || "",
						}));
					}
					default:
						return [];
				}
			} catch (e) {
				logger.error("[Tools] Error searching DB", { error: e });
				return [];
			}
		},
	});
}
