import { builtinBlockSchemas } from "@fluxify/blocks";
import type { AgentOutputValidator } from "../../../types";
import { detectCycles } from "./cycleDetector";
import type { BlockBuilderResult, ValidatableBlock } from "./schemas";

const BUILTIN_WHITELIST = new Set([
	"entrypoint",
	"consolelog",
	"httpgetrequestbody",
	"sticky_note",
]);

function extractBlocksToValidate(
	typedResult: BlockBuilderResult,
): ValidatableBlock[] {
	const blocksToValidate: ValidatableBlock[] = [];

	if (typedResult.blocks && Array.isArray(typedResult.blocks)) {
		for (const b of typedResult.blocks) {
			if (b && typeof b === "object") {
				blocksToValidate.push(b as ValidatableBlock);
			}
		}
	}

	if (typedResult.canvasChanges && Array.isArray(typedResult.canvasChanges)) {
		for (const change of typedResult.canvasChanges) {
			if (
				change?.type === "block_change" &&
				change.data?.blocksInfo &&
				Array.isArray(change.data.blocksInfo)
			) {
				for (const b of change.data.blocksInfo) {
					if (b && typeof b === "object") {
						blocksToValidate.push(b as ValidatableBlock);
					}
				}
			}
		}
	}

	return blocksToValidate;
}

function collectCustomBlockNames(
	blocksToValidate: ValidatableBlock[],
): Set<string> {
	const customBlockNames = new Set<string>();
	for (const block of blocksToValidate) {
		const bType = block.blockType || "";
		if (bType.startsWith("custom:")) {
			customBlockNames.add(bType.slice(7));
		} else {
			const normType = bType.toLowerCase().replace(/_/g, "");
			if (
				!builtinBlockSchemas[normType] &&
				bType &&
				!BUILTIN_WHITELIST.has(bType)
			) {
				customBlockNames.add(bType);
			}
		}
	}
	return customBlockNames;
}

function validateCustomBlockField(
	blockId: string,
	customName: string,
	param: { name: string; type: string; options?: Array<{ value: unknown }> },
	val: unknown,
): string | null {
	if (typeof val === "string" && val.startsWith("js:")) {
		return null; // Allow JS expressions
	}

	switch (param.type) {
		case "text_input":
		case "integration_selector":
			if (val !== undefined && val !== null && typeof val !== "string") {
				return `Block "${blockId}" of custom type "${customName}" has invalid field "${param.name}": expected a string value, but received type "${typeof val}".`;
			}
			break;
		case "checkbox":
			if (val !== undefined && val !== null && typeof val !== "boolean") {
				return `Block "${blockId}" of custom type "${customName}" has invalid field "${param.name}": expected a boolean value, but received type "${typeof val}".`;
			}
			break;
		case "array_editor":
			if (val !== undefined && val !== null && !Array.isArray(val)) {
				return `Block "${blockId}" of custom type "${customName}" has invalid field "${param.name}": expected an array, but received type "${typeof val}".`;
			}
			break;
		case "dropdown":
			if (val !== undefined && val !== null) {
				const validOptions = (param.options || []).map((o) => o.value);
				if (validOptions.length > 0 && !validOptions.includes(val)) {
					return `Block "${blockId}" of custom type "${customName}" has invalid option for field "${param.name}": "${val}". Allowed options are: ${validOptions.map((o) => `"${o}"`).join(", ")}.`;
				}
			}
			break;
	}

	return null;
}

function validateBlockAgainstSchemas(
	block: ValidatableBlock,
	customBlockSchemasMap: Map<string, any[]>,
): string[] {
	const errors: string[] = [];
	const rawType = block.blockType || "";
	const normType = rawType.toLowerCase().replace(/_/g, "");
	const isCustom =
		rawType.startsWith("custom:") ||
		(!builtinBlockSchemas[normType] && customBlockSchemasMap.has(rawType));
	const customName = isCustom
		? rawType.startsWith("custom:")
			? rawType.slice(7)
			: rawType
		: null;

	if (isCustom && customName) {
		const inputParams = customBlockSchemasMap.get(customName);
		if (!inputParams) {
			errors.push(
				`Block "${block.id}" specifies custom block type "${customName}", but no custom block with that name exists in the project.`,
			);
			return errors;
		}

		const blockData = (block.data || {}) as Record<string, unknown>;
		for (const param of inputParams) {
			const err = validateCustomBlockField(
				block.id,
				customName,
				param,
				blockData[param.name],
			);
			if (err) errors.push(err);
		}
	} else {
		// Built-in block
		const schema = builtinBlockSchemas[normType];
		if (schema) {
			const parseResult = schema.safeParse(block.data || {});
			if (!parseResult.success) {
				for (const issue of parseResult.error.issues) {
					const fieldPath =
						issue.path.length > 0
							? `field "${issue.path.join(".")}"`
							: "block data";
					errors.push(
						`Block "${block.id}" of built-in type "${rawType}" has invalid ${fieldPath}: ${issue.message}.`,
					);
				}
			}
		}
	}

	return errors;
}

export const validateBlockBuilderOutput: AgentOutputValidator = async (
	result,
	taskId,
	state,
) => {
	const typedResult = result as BlockBuilderResult;

	if (!typedResult || typeof typedResult !== "object") {
		return "Result is invalid or empty object.";
	}

	if (!typedResult.status) {
		return "Missing 'status' field in result. Status must be 'success' or 'impossible'.";
	}

	if (typedResult.status === "impossible") {
		if (!typedResult.reasoning) {
			return "Status is marked as 'impossible', but no reasoning provided explaining why construction is impossible.";
		}
		return typedResult.reasoning;
	}

	if (!typedResult.targetType || !typedResult.targetId) {
		return "Missing 'targetType' or 'targetId'. You must associate the canvas configuration with either a route or custom block ID.";
	}

	if (!typedResult.blocks && !typedResult.canvasChanges) {
		return "Result must contain either 'blocks' (new blocks to add) or 'canvasChanges' (mutations to existing blocks).";
	}

	const blocksToValidate = extractBlocksToValidate(typedResult);

	const cycleError = detectCycles(blocksToValidate);
	if (cycleError) {
		return cycleError;
	}

	const customBlockNamesToFetch = collectCustomBlockNames(blocksToValidate);

	const projectId = state.internal?.metadata?.projectId || "";
	let customBlockSchemasMap = new Map<string, any[]>();
	if (customBlockNamesToFetch.size > 0 && state.internal?.dbService) {
		customBlockSchemasMap =
			await state.internal.dbService.getCustomBlocksBatch(
				projectId,
				Array.from(customBlockNamesToFetch),
			);
	}

	const errors: string[] = [];
	for (const block of blocksToValidate) {
		errors.push(...validateBlockAgainstSchemas(block, customBlockSchemasMap));
	}

	if (errors.length > 0) {
		return `Validation failed for the generated canvas configuration:\n${errors.map((e, idx) => `${idx + 1}. ${e}`).join("\n")}\nPlease correct these fields in your retry.`;
	}

	return null;
};
