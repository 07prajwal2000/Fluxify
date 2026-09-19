import {
	arrayOperationsBlockSchema,
	BlockTypes,
	cloudLogsBlockSchema,
	deleteDbBlockSchema,
	entrypointBlockSchema,
	errorHandlerBlockSchema,
	forEachLoopBlockSchema,
	forLoopBlockSchema,
	getAllDbBlockSchema,
	getHttpCookieBlockSchema,
	getHttpHeaderBlockSchema,
	getHttpParamBlockSchema,
	getHttpRequestBodyBlockSchema,
	getSingleDbBlockSchema,
	getVarBlockSchema,
	httpRequestBlockSchema,
	ifBlockSchema,
	insertBulkDbBlockSchema,
	insertDbBlockSchema,
	jsRunnerBlockSchema,
	kvOperationsBlockSchema,
	kvRawBlockSchema,
	logBlockSchema,
	nativeDbBlockSchema,
	orchestratorBlockSchema,
	responseBlockSchema,
	setHttpCookieBlockSchema,
	setHttpHeaderBlockSchema,
	setVarSchema,
	stickyNotesSchema,
	switchBlockSchema,
	transactionDbBlockSchema,
	transformerBlockSchema,
	triggerWorkflowSchema,
	updateDbBlockSchema,
} from "@fluxify/blocks";
import { variableNameError } from "@fluxify/blocks/variableName";
import type { Context, Next } from "hono";
import type z from "zod";
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

	const errorBlocks: string[] = [];
	const nameErrors: { field: string; message: string }[] = [];

	for (const block of data.changes.blocks) {
		if (deleteIds.has(block.id)) continue;
		// before the type switch: custom blocks skip schema validation below
		const nameError = saveAsVariableError(block.data);
		if (nameError) {
			const label = (block.data as { blockName?: unknown })?.blockName;
			nameErrors.push({
				field: block.id,
				message: `${typeof label === "string" && label ? label : block.type}: ${nameError}`,
			});
		}
		let schema: z.ZodType = null!;
		switch (block.type as BlockTypes) {
			case BlockTypes.entrypoint:
				schema = entrypointBlockSchema;
				break;
			case BlockTypes.if:
				schema = ifBlockSchema;
				break;
			case BlockTypes.httprequest:
				schema = httpRequestBlockSchema;
				break;
			case BlockTypes.httpGetHeader:
				schema = getHttpHeaderBlockSchema;
				break;
			case BlockTypes.httpSetHeader:
				schema = setHttpHeaderBlockSchema;
				break;
			case BlockTypes.httpGetParam:
				schema = getHttpParamBlockSchema;
				break;
			case BlockTypes.httpGetCookie:
				schema = getHttpCookieBlockSchema;
				break;
			case BlockTypes.httpSetCookie:
				schema = setHttpCookieBlockSchema;
				break;
			case BlockTypes.httpGetRequestBody:
				schema = getHttpRequestBodyBlockSchema;
				break;
			case BlockTypes.forloop:
				schema = forLoopBlockSchema;
				break;
			case BlockTypes.foreachloop:
				schema = forEachLoopBlockSchema;
				break;
			case BlockTypes.transformer:
				schema = transformerBlockSchema;
				break;
			case BlockTypes.setvar:
				schema = setVarSchema;
				break;
			case BlockTypes.getvar:
				schema = getVarBlockSchema;
				break;
			case BlockTypes.consolelog:
				schema = logBlockSchema;
				break;
			case BlockTypes.jsrunner:
				schema = jsRunnerBlockSchema;
				break;
			case BlockTypes.response:
				schema = responseBlockSchema;
				break;
			case BlockTypes.arrayops:
				schema = arrayOperationsBlockSchema;
				break;
			case BlockTypes.db_getsingle:
				schema = getSingleDbBlockSchema;
				break;
			case BlockTypes.db_getall:
				schema = getAllDbBlockSchema;
				break;
			case BlockTypes.db_delete:
				schema = deleteDbBlockSchema;
				break;
			case BlockTypes.db_insert:
				schema = insertDbBlockSchema;
				break;
			case BlockTypes.db_insertbulk:
				schema = insertBulkDbBlockSchema;
				break;
			case BlockTypes.db_update:
				schema = updateDbBlockSchema;
				break;
			case BlockTypes.db_native:
				schema = nativeDbBlockSchema;
				break;
			case BlockTypes.db_transaction:
				schema = transactionDbBlockSchema;
				break;
			case BlockTypes.orchestrator:
				schema = orchestratorBlockSchema;
				break;
			case BlockTypes.switch:
				schema = switchBlockSchema;
				break;
			case BlockTypes.sticky_note:
				schema = stickyNotesSchema;
				break;
			case BlockTypes.errorHandler:
				schema = errorHandlerBlockSchema;
				if (block.id === block.data.next) {
					throw new BadRequestError("Error handler block cannot be connected to itself");
				}
				break;
			case BlockTypes.cloudLogs:
				schema = cloudLogsBlockSchema;
				break;
			case BlockTypes.triggerWorkflow:
				schema = triggerWorkflowSchema;
				break;
			case BlockTypes.kv_raw:
				schema = kvRawBlockSchema;
				break;
			case BlockTypes.kv_operations:
				schema = kvOperationsBlockSchema;
				break;
		}
		if (!schema) {
			if (customBlockNames.has(block.type)) {
				continue;
			}
			throw new BadRequestError("Invalid block type");
		}
		const result = schema.safeParse(block.data);
		if (!result.success) {
			errorBlocks.push(block.id);
		} else {
			block.data = result.data;
		}
	}

	if (errorBlocks.length > 0 || nameErrors.length > 0) {
		throw new ValidationError([
			...errorBlocks.map((id) => ({
				field: id,
				message: "Invalid block data",
			})),
			...nameErrors,
		]);
	}
}

/** Why an enabled "Save output to variable" name can't be used, if it can't. */
function saveAsVariableError(data: unknown): string | undefined {
	const setting = (data as { saveAsVariable?: { enabled?: unknown; name?: unknown } })
		?.saveAsVariable;
	if (setting?.enabled !== true) return undefined;
	return variableNameError(typeof setting.name === "string" ? setting.name.trim() : "");
}
