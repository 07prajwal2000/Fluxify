import { fencedTool } from "./fenced";
import { z } from "zod";
import { logger } from "@fluxify/common";
import type { WorkflowMetadata } from "../types";
import {
	decodeResourceCursor,
	type DbService,
	type SearchMode,
} from "../internal/dbService";
import { ResourceType } from "../types";
import { renderCanvas } from "../internal/renderCanvas";

function isListRequest(keywords: string[], mode: SearchMode): boolean {
	return (
		mode === "keyword" &&
		keywords.length === 1 &&
		["*", "all"].includes(keywords[0]?.trim().toLowerCase() ?? "")
	);
}

function renderResults(results: any[], nextCursor?: string): string {
	if (results.length === 0) return "No resources found.";
	const keys = Object.keys(results[0]);
	const header = `| ${keys.join(" | ")} |\n| ${keys.map(() => "---").join(" | ")} |`;
	const rows = results
		.map(
			(row) =>
				`| ${keys
					.map((key) =>
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
	return `${header}\n${rows}${nextCursor ? `\n\nMore results exist. Call find_resource again with this exact cursor: \`${nextCursor}\`.` : ""}`;
}

const RESOURCE_TYPES = [
	"route",
	"app_config",
	"integration",
	"custom_block",
	"route_canvas",
	"custom_block_canvas",
] as const;

export const createFindResourceTool = (
	dbService: DbService,
	metadata: WorkflowMetadata,
	/**
	 * Drops the two canvas lookups when the run has already put the target
	 * canvas in the agent's context. Searching for routes, integrations and app
	 * configs stays — that is a real need this agent still has. Only the
	 * redundant re-fetch goes, and it goes by being absent: the context block
	 * already asks the agent not to make this call, and it made it anyway.
	 */
	options?: { withoutCanvasLookup?: boolean },
) => {
	const resourceTypes = (
		options?.withoutCanvasLookup
			? RESOURCE_TYPES.filter((type) => !type.endsWith("_canvas"))
			: RESOURCE_TYPES
	) as unknown as [string, ...string[]];

	return fencedTool(
		async ({ searchQuery, resourceType, searchBy, cursor, metadata: toolMetadata }) => {
			// Normalize to a keyword array; canvas/ID lookups use the first value.
			const keywords = Array.isArray(searchQuery) ? searchQuery : [searchQuery];
			const singleId = keywords[0] ?? "";
			// `.nullish()` per the schema rules, so null has to collapse too.
			const mode: SearchMode = searchBy === "id" ? "id" : "keyword";
			const listRequest = isListRequest(keywords, mode);

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

			if (listRequest) {
				if (
					resourceType !== "route" &&
					resourceType !== "app_config" &&
					resourceType !== "integration" &&
					resourceType !== "custom_block"
				) {
					return "Listing is supported for routes, app configs, integrations, and custom blocks; choose one of those resource types.";
				}

				let afterId: string | undefined;
				try {
					afterId = cursor
						? decodeResourceCursor(cursor, resourceType)
						: undefined;
				} catch (error) {
					return error instanceof Error ? error.message : "Invalid cursor.";
				}

				const page =
					resourceType === "route"
						? await dbService.listRoutes(metadata.projectId, afterId)
						: resourceType === "app_config"
							? await dbService.listAppConfigs(
									metadata.projectId,
									afterId === undefined ? undefined : Number(afterId),
								)
							: resourceType === "integration"
								? await dbService.listIntegrations(metadata.projectId, afterId)
								: await dbService.listCustomBlocks(metadata.projectId, afterId);
				return renderResults(page.items, page.nextCursor);
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

			return renderResults(results);
		},
		{
			name: "find_resource",
			description: options?.withoutCanvasLookup
				? "Search the production database for existing resources (routes, app configs, integrations, custom blocks) in the user's project. Canvas lookup is not available here — the canvas you are editing is already in your context."
				: "Search the production database for existing resources (routes, app configs, integrations, custom blocks) in the user's project, or retrieve canvas details.",
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
			cursor: z
				.string()
				.nullish()
				.describe(
					"Opaque continuation cursor from a previous all/* listing. Omit for the first page; copy it exactly for the next 20 results.",
				),
				resourceType: z
					.enum(resourceTypes)
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
