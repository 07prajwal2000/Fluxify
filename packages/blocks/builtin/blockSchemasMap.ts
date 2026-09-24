import type z from "zod";
import { arrayOperationsBlockSchema } from "./arrayOperations";
import { deleteDbBlockSchema } from "./db/delete";
import { getAllDbBlockSchema } from "./db/getAll";
import { getSingleDbBlockSchema } from "./db/getSingle";
import { insertDbBlockSchema } from "./db/insert";
import { insertBulkDbBlockSchema } from "./db/insertBulk";
import { nativeDbBlockSchema } from "./db/native";
import { rollbackDbBlockSchema } from "./db/rollback";
import { transactionDbBlockSchema } from "./db/transaction";
import { updateDbBlockSchema } from "./db/update";
import { errorHandlerBlockSchema } from "./errorHandler";
import { getVarBlockSchema } from "./getVar";
import { getHttpCookieBlockSchema } from "./http/getHttpCookie";
import { getHttpHeaderBlockSchema } from "./http/getHttpHeader";
import { getHttpParamBlockSchema } from "./http/getHttpParam";
import { setHttpCookieBlockSchema } from "./http/setHttpCookie";
import { setHttpHeaderBlockSchema } from "./http/setHttpHeader";
import { httpRequestBlockSchema } from "./httpRequest";
import { ifBlockSchema } from "./if";
import { jsRunnerBlockSchema } from "./jsRunner";
import { kvOperationsBlockSchema } from "./kv/operations";
import { kvRawBlockSchema } from "./kv/rawConnection";
import { cloudLogsBlockSchema } from "./log/cloudLogs";
import { forLoopBlockSchema } from "./loops/for";
import { forEachLoopBlockSchema } from "./loops/foreach";
import { orchestratorBlockSchema } from "./orchestrator";
import { responseBlockSchema } from "./response";
import { setVarSchema } from "./setVar";
import { switchBlockSchema } from "./switch";
import { transformerBlockSchema } from "./transformer";
import { triggerWorkflowSchema } from "./triggerWorkflow";

export const builtinBlockSchemas: Record<string, z.ZodTypeAny> = {
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
};
