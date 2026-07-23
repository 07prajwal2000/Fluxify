import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "@fluxify/common";
import { queryDocs } from "../../db/vector";

async function performDocsSearch(
	searchQuery: string,
	limit: number = 3,
): Promise<string> {
	try {
		const results = await queryDocs(searchQuery, limit);
		return results.map((r) => r.content).join("\n\n--- \n\n");
	} catch (e) {
		logger.error("[Tools] Error searching vector DB", { error: e });
		return "Error retrieving documentation.";
	}
}

export const searchDocsTool = tool(
	async ({ searchQuery }) => {
		logger.info(`[Tools] Searching docs for: ${searchQuery}`);
		return await performDocsSearch(searchQuery);
	},
	{
		name: "search_docs",
		description:
			"Search the platform documentation using keywords. Use relevant terms for e.g. if user asks about filters, use keyword filter/filters.",
		schema: z.object({
			searchQuery: z
				.string()
				.describe("The keywords to find relevant documentation."),
		}),
	},
);
