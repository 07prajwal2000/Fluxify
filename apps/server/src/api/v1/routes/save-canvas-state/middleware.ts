import z from "zod";
import { requestBodySchema } from "./dto";
import { ConflictError } from "../../../../errors/conflictError";
import {
	arrayOperationsBlockSchema,
	BlockTypes,
	forEachLoopBlockSchema,
	forLoopBlockSchema,
	getHttpCookieBlockSchema,
	getHttpHeaderBlockSchema,
	getHttpParamBlockSchema,
	getHttpRequestBodyBlockSchema,
	getVarBlockSchema,
	ifBlockSchema,
	jsRunnerBlockSchema,
	setHttpCookieBlockSchema,
	setHttpHeaderBlockSchema,
	setVarSchema,
	stickyNotesSchema,
	transformerBlockSchema,
	entrypointBlockSchema,
	httpRequestBlockSchema,
	logBlockSchema,
	responseBlockSchema,
	getSingleDbBlockSchema,
	getAllDbBlockSchema,
	deleteDbBlockSchema,
	insertDbBlockSchema,
	insertBulkDbBlockSchema,
	nativeDbBlockSchema,
	transactionDbBlockSchema,
	updateDbBlockSchema,
	errorHandlerBlockSchema,
} from "@fluxify/blocks";
import { Context, Next } from "hono";
import { ValidationError } from "../../../../errors/validationError";
import { BadRequestError } from "../../../../errors/badRequestError";
import { cloudLogsBlockSchema } from "@fluxify/blocks";

export async function requestBodyValidator(ctx: Context, next: Next) {
	const jsonData = await ctx.req.json();
	blockDataValidator(jsonData);
	return next();
}

function blockDataValidator(data: z.infer<typeof requestBodySchema>) {
	const deleteIds = new Set<string>();
	data.actionsToPerform.blocks.forEach((block) => {
		if (block.action !== "delete") return;
		deleteIds.add(block.id);
	});
	data.actionsToPerform.edges.forEach((edge) => {
		if (deleteIds.has(edge.id))
			throw new ConflictError("Edge Id conflicting with block");
		if (edge.action !== "delete") return;
		deleteIds.add(edge.id);
	});

	const errorBlocks: string[] = [];

	for (const block of data.changes.blocks) {
		if (deleteIds.has(block.id)) continue;
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
			case BlockTypes.sticky_note:
				schema = stickyNotesSchema;
				break;
			case BlockTypes.errorHandler:
				schema = errorHandlerBlockSchema;
				if (block.id === block.data.next) {
					throw new BadRequestError(
						"Error handler block cannot be connected to itself",
					);
				}
				break;
			case BlockTypes.cloudLogs:
				schema = cloudLogsBlockSchema;
				break;
		}
		if (!schema) throw new BadRequestError("Invalid block type");
		const result = schema.safeParse(block.data);
		if (!result.success) {
			errorBlocks.push(block.id);
		} else {
			block.data = result.data;
		}
	}

	if (errorBlocks.length > 0) {
		throw new ValidationError(
			errorBlocks.map((id) => ({
				field: id,
				message: "Invalid block data",
			})),
		);
	}
}
