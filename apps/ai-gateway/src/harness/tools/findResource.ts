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
		async ({ searchQuery, resourceType, metadata: toolMetadata }) => {
			// Normalize to a keyword array; canvas/ID lookups use the first value.
			const keywords = Array.isArray(searchQuery) ? searchQuery : [searchQuery];
			const singleId = keywords[0] ?? "";

			logger.info(
				`[Tools] Searching ${resourceType} for '${keywords.join(", ")}' in project ${metadata.projectId}`,
			);

			if (resourceType === "route_canvas") {
				if (toolMetadata?.isNewRoute) {
					return JSON.stringify([
						{ id: "entrypoint", blockType: "entrypoint" },
						{ id: "response", blockType: "response" },
						{ id: "error_handler", blockType: "error_handler" }
					], null, 2);
				}
				const canvas = await dbService.getRouteCanvas(metadata.projectId, singleId);
				return canvas ? JSON.stringify(canvas, null, 2) : "No canvas found.";
			}

			if (resourceType === "custom_block_canvas") {
				const canvas = await dbService.getCustomBlockCanvas(metadata.projectId, singleId);
				return canvas ? JSON.stringify(canvas, null, 2) : "No canvas found.";
			}

			let results: any[] = [];
			switch (resourceType as ResourceType) {
				case "route":
					results = await dbService.findRoutes(metadata.projectId, keywords);
					break;
				case "app_config":
					results = await dbService.findAppConfigs(
						metadata.projectId,
						keywords,
					);
					break;
				case "integration":
					results = await dbService.findIntegrations(
						metadata.projectId,
						keywords,
					);
					break;
				case "custom_block":
					results = await dbService.findCustomBlocks(
						metadata.projectId,
						keywords,
					);
					break;
			}

			if (!results || results.length === 0) {
				return "No resources found.";
			}

			// Format as Markdown table
			const keys = Object.keys(results[0]);
			const header = `| ${keys.join(" | ")} |\n| ${keys.map(() => "---").join(" | ")} |`;
			const rows = results.map(row => 
				`| ${keys.map(key => String(row[key] ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`
			).join("\n");

			return `${header}\n${rows}`;
		},
		{
			name: "find_resource",
			description:
				"Search the production database for existing resources (routes, app configs, integrations, custom blocks) in the user's project, or retrieve canvas details.",
			schema: z.object({
				searchQuery: z
					.union([z.string(), z.array(z.string())])
					.describe(
						"One or more keywords to full-text search for (name, path, or description). Pass an array of related terms (e.g. ['user', 'auth', 'login']) to widen matching and avoid multiple retries. For 'route_canvas' and 'custom_block_canvas', pass a single resource ID.",
					),
				resourceType: z
					.enum(["route", "app_config", "integration", "custom_block", "route_canvas", "custom_block_canvas"])
					.describe("The type of resource to search for."),
				metadata: z.object({
					isNewRoute: z.boolean().optional(),
				}).optional(),
			}),
		},
	);
};
