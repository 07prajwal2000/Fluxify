import { tool } from "ai";
import { z } from "zod";
import { queryVectorDB } from "../db/vector";
import { logger } from "@fluxify/common";
import type { WorkflowMetadata } from "../ai/types";

export enum WorkflowToolName {
	SEARCH_DOCS = "search_docs",
	GET_ROUTE_DETAILS = "get_route_details",
}

export function createWorkflowTools(metadata: WorkflowMetadata) {
	return {
		[WorkflowToolName.SEARCH_DOCS]: tool({
			description:
				"Search the platform documentation using a natural language query.",
			inputSchema: z.object({
				searchQuery: z
					.string()
					.describe("The search query to find relevant documentation."),
			}),
			execute: async ({ searchQuery }) => {
				logger.info(`[Tools] Searching docs for: ${searchQuery}`);
				try {
					const results = await queryVectorDB(searchQuery, 5);
					return results.map((r) => r.content).join("\n\n---\n\n");
				} catch (e) {
					logger.error("[Tools] Error searching vector DB", { error: e });
					return "Error retrieving documentation.";
				}
			},
		}),

		[WorkflowToolName.GET_ROUTE_DETAILS]: tool({
			description:
				"Get the details of the user's current route information based on their browser location.",
			inputSchema: z.object({}), // No parameters required
			execute: async () => {
				logger.info(
					`[Tools] Getting route details for routeId: ${metadata.routeId}, project: ${metadata.projectId}, location: ${metadata.location}`,
				);
				// Return dummy empty object stringified
				return Promise.resolve("{}");
			},
		}),
	};
}
