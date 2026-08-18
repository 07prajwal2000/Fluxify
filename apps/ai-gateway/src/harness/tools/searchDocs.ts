import { fencedTool } from "./fenced";
import { z } from "zod";
import { logger } from "@fluxify/common";
import { queryDocs } from "../../db/vector";

/** ponytail: flat cap — one agent turn never legitimately needs more topics. */
const MAX_QUERIES_PER_CALL = 5;

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

export const searchDocsTool = fencedTool(
	async ({ searchQueries }) => {
		// One tool call per keyword meant one model round-trip per keyword, and
		// the agents reliably needed four or five. Batching collapses that into
		// a single round-trip.
		const queries = [...new Set(searchQueries)].slice(0, MAX_QUERIES_PER_CALL);
		logger.info(`[Tools] Searching docs for: ${queries.join(" | ")}`);

		const sections = await Promise.all(
			queries.map(async (query) => {
				const seen = new Set<string>();
				const content = await performDocsSearch(query);
				return seen.has(content) ? "" : `## Results for "${query}"\n\n${content}`;
			}),
		);

		return sections.filter(Boolean).join("\n\n===\n\n");
	},
	{
		name: "search_docs",
		description:
			`Search the platform documentation. Pass ALL the topics you need in one call — batching is far cheaper than calling this repeatedly. Use relevant keywords, e.g. for filters use "filter". At most ${MAX_QUERIES_PER_CALL} queries per call.`,
		schema: z.object({
			searchQueries: z
				.array(z.string())
				.min(1)
				.describe(
					`Keywords to look up, one entry per topic (e.g. ["js expressions", "http request block"]). At most ${MAX_QUERIES_PER_CALL}.`,
				),
		}),
	},
);
