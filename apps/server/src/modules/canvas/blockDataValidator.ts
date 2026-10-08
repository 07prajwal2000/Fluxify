import { BlockTypes, blockDataIssues, blockDataSchema } from "@fluxify/blocks";
import { variableNameError } from "@fluxify/blocks/variableName";
import type { Context, Next } from "hono";
import { BadRequestError } from "../../errors/badRequestError";
import { ConflictError } from "../../errors/conflictError";
import { ValidationError } from "../../errors/validationError";
import { customBlockNames } from "../../loaders/customBlocksLoader";
import type { CanvasChanges } from "./types";

/**
 * Validates each block's `data` against the schema for its type, before the
 * canvas is written.
 *
 * One implementation for every canvas — a route, a custom block and a workflow
 * hold the same blocks, so they get the same check. It used to be two
 * byte-identical copies under `api/v1`, which is how a third would have arrived
 * with workflows.
 */
export async function requestBodyValidator(ctx: Context, next: Next) {
	const jsonData = await ctx.req.json();
	blockDataValidator(jsonData);
	return next();
}

/** Exported for the test that holds every block type to having a schema. */
export function blockDataValidator(data: CanvasChanges) {
	const deleteIds = new Set<string>();
	data.actionsToPerform.blocks.forEach((block) => {
		if (block.action !== "delete") return;
		deleteIds.add(block.id);
	});
	data.actionsToPerform.edges.forEach((edge) => {
		if (deleteIds.has(edge.id)) throw new ConflictError("Edge Id conflicting with block");
		if (edge.action !== "delete") return;
		deleteIds.add(edge.id);
	});

	const errors: { field: string; message: string }[] = [];

	for (const block of data.changes.blocks) {
		if (deleteIds.has(block.id)) continue;
		// before the type switch: custom blocks skip schema validation below
		const nameError = saveAsVariableError(block.data);
		if (nameError) {
			const label = (block.data as { blockName?: unknown })?.blockName;
			errors.push({
				field: block.id,
				message: `${typeof label === "string" && label ? label : block.type}: ${nameError}`,
			});
		}
		if (block.type === BlockTypes.errorHandler && block.id === block.data?.next) {
			throw new BadRequestError("Error handler block cannot be connected to itself");
		}
		const schema = blockDataSchema(block.type);
		if (!schema) {
			if (customBlockNames.has(block.type)) {
				continue;
			}
			throw new BadRequestError(
				`Unknown block type: ${block.type}. Use a built-in block type or a custom block defined in this project.`,
			);
		}
		const result = schema.safeParse(block.data);
		if (result.success) {
			block.data = result.data;
			continue;
		}
		// the same readable messages the canvas rules refuse with on every other save path
		for (const issue of blockDataIssues([block]))
			errors.push({ field: block.id, message: issue.message });
	}

	if (errors.length > 0) throw new ValidationError(errors);
}

/** Why an enabled "Save output to variable" name can't be used, if it can't. */
function saveAsVariableError(data: unknown): string | undefined {
	const setting = (data as { saveAsVariable?: { enabled?: unknown; name?: unknown } })
		?.saveAsVariable;
	if (setting?.enabled !== true) return undefined;
	return variableNameError(typeof setting.name === "string" ? setting.name.trim() : "");
}
