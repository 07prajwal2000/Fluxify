import type z from "zod";
import { arrayOperationsBlockSchema } from "./arrayOperations";
import { countDbBlockSchema } from "./db/count";
import { deleteDbBlockSchema } from "./db/delete";
import { getAllDbBlockSchema } from "./db/getAll";
import { getSingleDbBlockSchema } from "./db/getSingle";
import { insertDbBlockSchema } from "./db/insert";
import { insertBulkDbBlockSchema } from "./db/insertBulk";
import { nativeDbBlockSchema } from "./db/native";
import { rollbackDbBlockSchema } from "./db/rollback";
import { transactionDbBlockSchema } from "./db/transaction";
import { updateDbBlockSchema } from "./db/update";
import { entrypointBlockSchema } from "./entrypoint";
import { errorHandlerBlockSchema } from "./errorHandler";
import { getVarBlockSchema } from "./getVar";
import { getHttpCookieBlockSchema } from "./http/getHttpCookie";
import { getHttpHeaderBlockSchema } from "./http/getHttpHeader";
import { getHttpParamBlockSchema } from "./http/getHttpParam";
import { getHttpRequestBodyBlockSchema } from "./http/getHttpRequestBody";
import { setHttpCookieBlockSchema } from "./http/setHttpCookie";
import { setHttpHeaderBlockSchema } from "./http/setHttpHeader";
import { httpRequestBlockSchema } from "./httpRequest";
import { ifBlockSchema } from "./if";
import { jsRunnerBlockSchema } from "./jsRunner";
import { kvOperationsBlockSchema } from "./kv/operations";
import { kvRawBlockSchema } from "./kv/rawConnection";
import { logBlockSchema } from "./log";
import { cloudLogsBlockSchema } from "./log/cloudLogs";
import { forLoopBlockSchema } from "./loops/for";
import { forEachLoopBlockSchema } from "./loops/foreach";
import { orchestratorBlockSchema } from "./orchestrator";
import { sendMessageBlockSchema } from "./queue/sendMessage";
import { responseBlockSchema } from "./response";
import { retryBlockSchema } from "./retry";
import { setVarSchema } from "./setVar";
import { stickyNotesSchema } from "./stickyNote";
import { switchBlockSchema } from "./switch";
import { transformerBlockSchema } from "./transformer";
import { triggerWorkflowSchema } from "./triggerWorkflow";

/** every built-in block's data schema, keyed by its type without `_`; see `blockDataSchema` */
export const builtinBlockSchemas: Record<string, z.ZodTypeAny> = {
	entrypoint: entrypointBlockSchema,
	httpgetrequestbody: getHttpRequestBodyBlockSchema,
	consolelog: logBlockSchema,
	stickynote: stickyNotesSchema,
	if: ifBlockSchema,
	httprequest: httpRequestBlockSchema,
	httpgetheader: getHttpHeaderBlockSchema,
	httpsetheader: setHttpHeaderBlockSchema,
	httpgetparam: getHttpParamBlockSchema,
	httpgetcookie: getHttpCookieBlockSchema,
	httpsetcookie: setHttpCookieBlockSchema,
	forloop: forLoopBlockSchema,
	foreachloop: forEachLoopBlockSchema,
	orchestrator: orchestratorBlockSchema,
	switch: switchBlockSchema,
	transformer: transformerBlockSchema,
	setvar: setVarSchema,
	getvar: getVarBlockSchema,
	jsrunner: jsRunnerBlockSchema,
	response: responseBlockSchema,
	arrayops: arrayOperationsBlockSchema,
	dbgetsingle: getSingleDbBlockSchema,
	dbexists: getSingleDbBlockSchema,
	dbcount: countDbBlockSchema,
	dbgetall: getAllDbBlockSchema,
	dbdelete: deleteDbBlockSchema,
	dbinsert: insertDbBlockSchema,
	dbinsertbulk: insertBulkDbBlockSchema,
	dbupdate: updateDbBlockSchema,
	dbnative: nativeDbBlockSchema,
	dbtransaction: transactionDbBlockSchema,
	dbrollback: rollbackDbBlockSchema,
	kvraw: kvRawBlockSchema,
	kvoperations: kvOperationsBlockSchema,
	errorhandler: errorHandlerBlockSchema,
	cloudlogs: cloudLogsBlockSchema,
	triggerworkflow: triggerWorkflowSchema,
	queuesend: sendMessageBlockSchema,
	retry: retryBlockSchema,
};
