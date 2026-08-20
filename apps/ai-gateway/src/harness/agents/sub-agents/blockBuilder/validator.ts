import { builtinBlockSchemas, BlockTypes } from "@fluxify/blocks";
import { resolveCustomBlockName, withCustomBlockPrefix } from "@fluxify/lib";
import type { AgentOutputValidator } from "../../../types";
import { detectCycles } from "./cycleDetector";
import { pendingCustomBlockSchemas } from "./pendingCustomBlocks";
import { validateGraphRules } from "./graphRules";
import type { BlockBuilderResult, ValidatableBlock } from "./schemas";

/** Storage stores these exact strings — anything else is a broken canvas. */
const BUILTIN_TYPES = new Set<string>(Object.values(BlockTypes));

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
		} else if (bType && !BUILTIN_TYPES.has(bType)) {
			// not a stored built-in type — the only other thing it can legally be
			// is a custom block the user authored, so look that up before failing it
			customBlockNames.add(bType);
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
		case "app_config_selector":
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

function validateCustomBlockInvoke(
	block: ValidatableBlock,
	customName: string,
): string | null {
	const invoke = (block.data as Record<string, unknown> | undefined)?.invoke;
	if (invoke === undefined || invoke === "sync" || invoke === "async" || invoke === "queued") return null;
	return `Block "${block.id}" invokes custom block "${customName}" with "${String(invoke)}". Use only "sync", "async", or "queued"; "scheduled" is not a runtime value.`;
}

function configuredCustomBlockParamNames(
	targetId: string | undefined,
	state: Parameters<AgentOutputValidator>[2],
): Set<string> | null {
	if (!targetId) return null;
	for (const result of Object.values(state.orchestratorState?.subAgentResults ?? {})) {
		const config = result as { customBlockId?: string; data?: { inputParams?: Array<{ name?: string }> } };
		if (config.customBlockId !== targetId) continue;
		return new Set((config.data?.inputParams ?? []).map((param) => param.name).filter((name): name is string => !!name));
	}
	return null;
}

function validateCustomBlockParameterReferences(
	blocks: ValidatableBlock[],
	params: Set<string> | null,
): string[] {
	if (!params) return [];
	const errors: string[] = [];
	for (const block of blocks) {
		const serialized = JSON.stringify(block.data ?? {});
		// The lookbehind matters: without it `input.params.id` or `data.params.x`
		// — ordinary property access on a previous block's output — reads as a
		// caller parameter and bounces a correct canvas back for a retry.
		for (const match of serialized.matchAll(
			/(?:(?<![\w.])params\.([a-zA-Z0-9_]+)|(?<![\w.])param:([a-zA-Z0-9_]+))/g,
		)) {
			const name = match[1] ?? match[2];
			if (name && !params.has(name)) errors.push(`Block "${block.id}" references custom-block parameter "${name}", but it is absent from the paired Custom Block Config Agent output.`);
		}
	}
	return errors;
}

function validateBlockAgainstSchemas(
	block: ValidatableBlock,
	customBlockSchemasMap: Map<string, any[]>,
): string[] {
	const errors: string[] = [];
	const rawType = block.blockType || "";
	const normType = rawType.toLowerCase().replace(/_/g, "");
	const isCustom = rawType.startsWith("custom:") || !BUILTIN_TYPES.has(rawType);
	const customName = isCustom
		? rawType.startsWith("custom:")
			? rawType.slice(7)
			: rawType
		: null;

	if (isCustom && customName) {
		const invokeError = validateCustomBlockInvoke(block, customName);
		if (invokeError) errors.push(invokeError);
		// `agent.ts` already rewrote known references to their stored name; this
		// resolve covers the paths that skip it — a resumed run, a re-validation.
		const inputParams = customBlockSchemasMap.get(
			resolveCustomBlockName(customName, new Set(customBlockSchemasMap.keys())),
		);
		if (!inputParams) {
			// A near-miss on a built-in name (`get_http_header` for `httpgetheader`)
			// used to sail through and persist a type nothing can execute.
			const suggestion = [...BUILTIN_TYPES].find(
				(type) => type.replace(/_/g, "").toLowerCase() === normType,
			);
			errors.push(
				suggestion
					? `Block "${block.id}" uses blockType "${rawType}", which is not a valid type. Use "${suggestion}" exactly as listed in the available blocks table.`
					: `Block "${block.id}" specifies block type "${customName}", but it is neither a built-in block nor a custom block in this project. Use a type exactly as listed in the available blocks table.`,
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
	if (customBlockNamesToFetch.size > 0) {
		const dbSchemas = state.internal?.dbService
			? await state.internal.dbService.getCustomBlocksBatch(
					projectId,
					// Both forms: the canvas may hold the bare name while the row is
					// stored prefixed, and inhouse blocks are stored bare.
					Array.from(customBlockNamesToFetch).flatMap((name) => [
						name,
						withCustomBlockPrefix(name),
					]),
				)
			: new Map<string, any[]>();
		// Pending first so a real record always wins over a proposal: the block
		// may exist already under the same name, and the stored schema is the one
		// the canvas will actually execute against.
		customBlockSchemasMap = new Map<string, any[]>([
			...pendingCustomBlockSchemas(state, taskId),
			...dbSchemas,
		]);
	}

	const errors: string[] = validateGraphRules(blocksToValidate);
	if (typedResult.targetType === "custom_block") {
		errors.push(...validateCustomBlockParameterReferences(
			blocksToValidate,
			configuredCustomBlockParamNames(typedResult.targetId, state),
		));
	}
	for (const block of blocksToValidate) {
		errors.push(...validateBlockAgainstSchemas(block, customBlockSchemasMap));
	}

	if (errors.length > 0) {
		return `Validation failed for the generated canvas configuration:\n${errors.map((e, idx) => `${idx + 1}. ${e}`).join("\n")}\nPlease correct these fields in your retry.`;
	}

	return null;
};
