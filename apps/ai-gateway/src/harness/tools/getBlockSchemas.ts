import { fencedTool } from "./fenced";
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
			case "app_config_selector":
				typeStr = "string // app config key; use getConfig(params.<name>), never a literal secret";
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

/** ponytail: flat cap. Raise it if a legitimate build needs more blocks
 *  configured in one turn. */
const MAX_BLOCK_TYPES_PER_CALL = 8;

export const createGetBlockSchemasTool = (
	dbService: DbService,
	projectId: string,
) => {
	return fencedTool(
		async ({ blockTypes }) => {
			logger.info(`[Tools] Fetching schemas for blocks: ${blockTypes.join(", ")}`);
			
			const results: string[] = [];
			// Uncapped, the model can ask for all 28 built-ins in one call — around
			// 5,000 tokens, re-sent on every later tool iteration. It only ever
			// needs the handful it is about to configure.
			const requestedTypes = [...new Set(blockTypes)].slice(
				0,
				MAX_BLOCK_TYPES_PER_CALL,
			);
			const dropped = new Set(blockTypes).size - requestedTypes.length;

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

			if (dropped > 0) {
				results.push(
					`// ${dropped} more block type(s) were not returned: this tool serves at most ${MAX_BLOCK_TYPES_PER_CALL} per call. Call it again for the rest.`,
				);
			}

			return results.join("\n\n");
		},
		{
			name: "get_block_schemas",
			description:
				`Fetches the detailed configuration schemas for the requested block types. For custom blocks, prefix the block name with 'custom:'. Returns at most ${MAX_BLOCK_TYPES_PER_CALL} schemas per call — request only the blocks you are about to configure.`,
			schema: z.object({
				blockTypes: z
					.array(z.string())
					.describe(`Array of block types to fetch schemas for (e.g. ['http_request', 'custom:stripe_charge']). At most ${MAX_BLOCK_TYPES_PER_CALL} per call.`),
			}),
		},
	);
};
