import { fencedTool } from "./fenced";
import { z } from "zod";
import { logger } from "@fluxify/common";
import type { WorkflowMetadata } from "../types";
import type { DbService, SearchMode } from "../internal/dbService";
import { ResourceType } from "../types";

/**
 * Canvases are the fattest thing this tool returns, and the whole result is
 * re-sent on every subsequent tool iteration. Two cuts: no pretty-printing
 * (indentation alone was ~15% of the payload) and no `position`, which is
 * layout the model neither reads nor sets. `data` stays — the block builder
 * edits existing blocks, and making it fetch that separately would add back
 * the round trip this is trying to remove.
 */
function renderCanvas(canvas: Array<Record<string, any>>): string {
	return JSON.stringify(
		canvas.map(({ position, ...block }) => block),
	);
}

export const createFindResourceTool = (
	dbService: DbService,
	metadata: WorkflowMetadata,
) => {
	return fencedTool(
		async ({ searchQuery, resourceType, searchBy, metadata: toolMetadata }) => {
			// Normalize to a keyword array; canvas/ID lookups use the first value.
			const keywords = Array.isArray(searchQuery) ? searchQuery : [searchQuery];
			const singleId = keywords[0] ?? "";
			// `.nullish()` per the schema rules, so null has to collapse too.
			const mode: SearchMode = searchBy === "id" ? "id" : "keyword";

			logger.info(
				`[Tools] ${mode === "id" ? "Fetching" : "Searching"} ${resourceType} by ${mode} '${keywords.join(", ")}' in project ${metadata.projectId}`,
			);

			if (resourceType === "route_canvas") {
				if (toolMetadata?.isNewRoute) {
					return JSON.stringify([
						{ id: "entrypoint", blockType: "entrypoint" },
						{ id: "response", blockType: "response" },
						{ id: "error_handler", blockType: "error_handler" },
					]);
				}
				const canvas = await dbService.getRouteCanvas(
					metadata.projectId,
					singleId,
				);
				return canvas ? renderCanvas(canvas) : "No canvas found.";
			}

			if (resourceType === "custom_block_canvas") {
				const canvas = await dbService.getCustomBlockCanvas(
					metadata.projectId,
					singleId,
				);
				return canvas ? renderCanvas(canvas) : "No canvas found.";
			}

			let results: any[] = [];
			switch (resourceType as ResourceType) {
				case "route":
					results = await dbService.findRoutes(
						metadata.projectId,
						keywords,
						mode,
					);
					break;
				case "app_config":
					results = await dbService.findAppConfigs(
						metadata.projectId,
						keywords,
						mode,
					);
					break;
				case "integration":
					results = await dbService.findIntegrations(
						metadata.projectId,
						keywords,
						mode,
					);
					break;
				case "custom_block":
					results = await dbService.findCustomBlocks(
						metadata.projectId,
						keywords,
						mode,
					);
					break;
			}

			if (!results || results.length === 0) {
				return mode === "id"
					? "No resource with that ID. It may have been deleted, or the ID may belong to another project — search by keyword instead of guessing another ID."
					: "No resources found.";
			}

			// Format as Markdown table
			const keys = Object.keys(results[0]);
			const header = `| ${keys.join(" | ")} |\n| ${keys.map(() => "---").join(" | ")} |`;
			const rows = results
				.map(
					(row) =>
						`| ${keys
							.map((key) =>
								// `inputParams` is an array; String() on it gives the
								// model nothing it can use
								(typeof row[key] === "object" && row[key] !== null
									? JSON.stringify(row[key])
									: String(row[key] ?? "")
								)
									.replace(/\|/g, "\\|")
									.replace(/\n/g, " "),
							)
							.join(" | ")} |`,
				)
				.join("\n");

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
						"What to look up. With searchBy='keyword' (default), one or more keywords matched against name, path and description — pass an array of related terms (e.g. ['user', 'auth', 'login']) to widen matching and avoid multiple retries. With searchBy='id', the exact resource ID. For 'route_canvas' and 'custom_block_canvas', pass a single resource ID.",
					),
				searchBy: z
					.enum(["keyword", "id"])
					.nullish()
					.describe(
						"'keyword' (default) fuzzy-searches names and descriptions. Use 'id' when you already have the resource's exact ID — from the plan, from your task description, or from an earlier tool result — and want that one record. An ID is not a keyword: fuzzy search will not find it.",
					),
				resourceType: z
					.enum([
						"route",
						"app_config",
						"integration",
						"custom_block",
						"route_canvas",
						"custom_block_canvas",
					])
					.describe("The type of resource to search for."),
				metadata: z
					.object({
						isNewRoute: z.boolean().optional(),
					})
					.optional(),
			}),
		},
	);
};
