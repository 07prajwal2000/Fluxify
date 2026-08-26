import { fencedTool } from "./fenced";
import { z } from "zod";
import { logger } from "@fluxify/common";
import { resolveCustomBlockName, withCustomBlockPrefix } from "@fluxify/lib";
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

/** A custom-block list is project data, unlike the static built-in catalogue.
 * Keep the escape hatch bounded so an agent cannot inject an entire project's
 * contracts into every later tool turn. */
const MAX_CUSTOM_BLOCKS_PER_CALL = 8;

export const createGetCustomBlockSchemasTool = (
	dbService: DbService,
	projectId: string,
	/** Custom blocks this run has proposed but not written yet. Without these the
	 *  model asks for the schema mid-run, is told the block does not exist, and
	 *  designs around it long before validation gets a chance to disagree. */
	pendingCustomBlocks: Map<string, Array<Record<string, unknown>>> = new Map(),
) => {
	return fencedTool(
		async ({ customBlockNames }) => {
			logger.info(
				`[Tools] Fetching custom block schemas: ${customBlockNames.join(", ")}`,
			);
			
			const results: string[] = [];
			const requestedNames = [...new Set(customBlockNames)].slice(
				0,
				MAX_CUSTOM_BLOCKS_PER_CALL,
			);
			const dropped = new Set(customBlockNames).size - requestedNames.length;

			for (const requestedName of requestedNames) {
				const customName = requestedName.replace(/^custom:/, "");
				// DB first, same precedence as the validator: a stored block under
				// this name is what the canvas will execute against. Both name forms
				// are tried because project blocks are prefixed while inhouse blocks
				// are stored bare.
				const inputParams =
					(await dbService.getCustomBlockInputParams(projectId, customName)) ??
					(await dbService.getCustomBlockInputParams(
						projectId,
						withCustomBlockPrefix(customName),
					)) ??
					pendingCustomBlocks.get(
						resolveCustomBlockName(
							customName,
							new Set(pendingCustomBlocks.keys()),
						),
					);
				if (inputParams) {
					const mappedSchema = mapInputParamsToNaturalLanguage(inputParams);
					results.push(`### Custom Block: ${customName}\n${mappedSchema}`);
				} else {
					results.push(
						`### Custom Block: ${customName}\n// Not found or no schema available`,
					);
				}
			}

			if (dropped > 0) {
				results.push(
					`// ${dropped} more custom block(s) were not returned: this tool serves at most ${MAX_CUSTOM_BLOCKS_PER_CALL} per call. Call it again for the rest.`,
				);
			}

			return results.join("\n\n");
		},
		{
			name: "get_custom_block_schemas",
			description:
				`Fetches detailed configuration contracts for custom blocks only. Built-in block schemas are already preloaded. Returns at most ${MAX_CUSTOM_BLOCKS_PER_CALL} contracts per call — request only custom blocks you are about to configure.`,
			schema: z.object({
				customBlockNames: z
					.array(z.string())
					.describe(`Array of custom block names to fetch (e.g. ['stripe_charge']). At most ${MAX_CUSTOM_BLOCKS_PER_CALL} per call.`),
			}),
		},
	);
};
