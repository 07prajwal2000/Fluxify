import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "@fluxify/common";
import { blockAiDescriptions } from "@fluxify/blocks";
import type { DbService } from "../internal/dbService";

function mapInputParamsToNaturalLanguage(inputParams: any[]): string {
	if (!inputParams || !Array.isArray(inputParams)) return "{}";
	const props: string[] = [];

	for (const param of inputParams) {
		const name = param.name;
		const label = param.label ? ` // ${param.label}` : "";
		let typeStr = "unknown";

		switch (param.type) {
			case "text_input":
				typeStr = "string";
				break;
			case "checkbox":
				typeStr = "boolean";
				break;
			case "array_editor":
				typeStr = "string[]";
				break;
			case "integration_selector":
				typeStr = "string // integration id";
				break;
			case "dropdown":
				if (param.options && Array.isArray(param.options)) {
					const opts = param.options.map((opt: any) => `"${opt.value}"`);
					typeStr = opts.join(" | ") || "string";
				} else {
					typeStr = "string";
				}
				break;
			default:
				typeStr = "any";
				break;
		}
		props.push(`  ${name}: ${typeStr};${label}`);
	}

	return `{\n${props.join("\n")}\n}`;
}

export const createGetBlockSchemasTool = (
	dbService: DbService,
	projectId: string,
) => {
	return tool(
		async ({ blockTypes }) => {
			logger.info(`[Tools] Fetching schemas for blocks: ${blockTypes.join(", ")}`);
			
			const results: string[] = [];
			const requestedTypes = new Set(blockTypes);

			for (const blockType of requestedTypes) {
				if (blockType.startsWith("custom:")) {
					const customName = blockType.replace("custom:", "");
					const inputParams = await dbService.getCustomBlockInputParams(projectId, customName);
					if (inputParams) {
						const mappedSchema = mapInputParamsToNaturalLanguage(inputParams);
						results.push(`### Custom Block: ${customName}\n${mappedSchema}`);
					} else {
						results.push(`### Custom Block: ${customName}\n// Not found or no schema available`);
					}
				} else {
					// Built-in block
					const builtin = blockAiDescriptions.find(b => b.name === blockType);
					if (builtin && builtin.jsonSchema) {
						results.push(`### Built-in Block: ${blockType}\n${builtin.jsonSchema}`);
					} else {
						results.push(`### Built-in Block: ${blockType}\n// Not found`);
					}
				}
			}

			return results.join("\n\n");
		},
		{
			name: "get_block_schemas",
			description:
				"Fetches the detailed configuration schemas for the requested block types. For custom blocks, prefix the block name with 'custom:'.",
			schema: z.object({
				blockTypes: z
					.array(z.string())
					.describe("Array of block types to fetch schemas for (e.g. ['http_request', 'custom:stripe_charge'])."),
			}),
		},
	);
};
