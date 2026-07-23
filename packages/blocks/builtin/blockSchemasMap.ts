import z from "zod";
import { ifBlockSchema } from "./if";
import { httpRequestBlockSchema } from "./httpRequest";
import { getHttpHeaderBlockSchema } from "./http/getHttpHeader";
import { getHttpParamBlockSchema } from "./http/getHttpParam";
import { getHttpCookieBlockSchema } from "./http/getHttpCookie";
import { setHttpCookieBlockSchema } from "./http/setHttpCookie";
import { forLoopBlockSchema } from "./loops/for";
import { forEachLoopBlockSchema } from "./loops/foreach";
import { transformerBlockSchema } from "./transformer";
import { setVarSchema } from "./setVar";
import { getVarBlockSchema } from "./getVar";
import { jsRunnerBlockSchema } from "./jsRunner";
import { responseBlockSchema } from "./response";
import { arrayOperationsBlockSchema } from "./arrayOperations";
import { getSingleDbBlockSchema } from "./db/getSingle";
import { getAllDbBlockSchema } from "./db/getAll";
import { deleteDbBlockSchema } from "./db/delete";
import { insertDbBlockSchema } from "./db/insert";
import { insertBulkDbBlockSchema } from "./db/insertBulk";
import { updateDbBlockSchema } from "./db/update";
import { nativeDbBlockSchema } from "./db/native";
import { transactionDbBlockSchema } from "./db/transaction";
import { errorHandlerBlockSchema } from "./errorHandler";
import { cloudLogsBlockSchema } from "./log/cloudLogs";

export const builtinBlockSchemas: Record<string, z.ZodTypeAny> = {
	if: ifBlockSchema,
	httprequest: httpRequestBlockSchema,
	httpgetheader: getHttpHeaderBlockSchema,
	httpsetheader: getHttpHeaderBlockSchema,
	httpgetparam: getHttpParamBlockSchema,
	httpgetcookie: getHttpCookieBlockSchema,
	httpsetcookie: setHttpCookieBlockSchema,
	forloop: forLoopBlockSchema,
	foreachloop: forEachLoopBlockSchema,
	transformer: transformerBlockSchema,
	setvar: setVarSchema,
	getvar: getVarBlockSchema,
	jsrunner: jsRunnerBlockSchema,
	response: responseBlockSchema,
	arrayops: arrayOperationsBlockSchema,
	arrayoperations: arrayOperationsBlockSchema,
	dbgetsingle: getSingleDbBlockSchema,
	dbgetall: getAllDbBlockSchema,
	dbdelete: deleteDbBlockSchema,
	dbinsert: insertDbBlockSchema,
	dbinsertbulk: insertBulkDbBlockSchema,
	dbupdate: updateDbBlockSchema,
	dbnative: nativeDbBlockSchema,
	dbtransaction: transactionDbBlockSchema,
	errorhandler: errorHandlerBlockSchema,
	cloudlogs: cloudLogsBlockSchema,
};
