import dayjs from "dayjs";
import { BlockTypes } from "./blockTypes";
import { scopeFor } from "./scope";
// type-only: the compiler imports this module for its tables, so a value
// import back the other way would close the cycle
import type { EmitNode } from "./compiler";
import { emitArrayOps } from "./builtin/arrayOperations";
import { emitEntrypoint } from "./builtin/entrypoint";
import { emitGetVar } from "./builtin/getVar";
import { emitIf } from "./builtin/if";
import { emitJsRunner } from "./builtin/jsRunner";
import { emitResponse } from "./builtin/response";
import { emitSetVar } from "./builtin/setVar";
import { emitTransformer } from "./builtin/transformer";
import { emitForLoop } from "./builtin/loops/for";
import { emitForEachLoop } from "./builtin/loops/foreach";
import { emitConsoleLog, runConsoleLog } from "./builtin/log/console";
import { emitCloudLogs, runCloudLog } from "./builtin/log/cloudLogs";
import {
	enqueueCustomBlock,
	invokeCustomBlock,
	invokeCustomBlockAsync,
} from "./builtin/customBlock";
import { emitHttpRequest, runHttpRequest } from "./builtin/httpRequest";
import { emitGetHttpHeader } from "./builtin/http/getHttpHeader";
import { emitSetHttpHeader } from "./builtin/http/setHttpHeader";
import { emitGetHttpParam } from "./builtin/http/getHttpParam";
import { emitGetHttpCookie } from "./builtin/http/getHttpCookie";
import { emitSetHttpCookie } from "./builtin/http/setHttpCookie";
import { emitGetHttpRequestBody } from "./builtin/http/getHttpRequestBody";
import { emitGetSingleDb, runGetSingleDb } from "./builtin/db/getSingle";
import { emitGetAllDb, runGetAllDb } from "./builtin/db/getAll";
import { emitInsertDb, runInsertDb } from "./builtin/db/insert";
import { emitInsertBulkDb, runInsertBulkDb } from "./builtin/db/insertBulk";
import { emitUpdateDb, runUpdateDb } from "./builtin/db/update";
import { emitDeleteDb, runDeleteDb } from "./builtin/db/delete";
import { emitNativeDb, runNativeDb } from "./builtin/db/native";
import { emitTransactionDb, runTransactionDb } from "./builtin/db/transaction";

/**
 * What the compiler knows how to emit, and what the emitted code may call.
 *
 * Both tables are just wiring — every block type in the product appears in one
 * or both — so they live beside each other and away from the code generator
 * itself. Adding a block is an entry here, not an edit to `compileGraph`.
 */
export type Emitter = (node: EmitNode) => string;

export const emitters: Partial<Record<BlockTypes, Emitter>> = {
	[BlockTypes.entrypoint]: emitEntrypoint,
	[BlockTypes.setvar]: emitSetVar,
	[BlockTypes.getvar]: emitGetVar,
	[BlockTypes.jsrunner]: emitJsRunner,
	[BlockTypes.response]: emitResponse,
	[BlockTypes.if]: emitIf,
	[BlockTypes.forloop]: emitForLoop,
	[BlockTypes.foreachloop]: emitForEachLoop,
	[BlockTypes.transformer]: emitTransformer,
	[BlockTypes.arrayops]: emitArrayOps,
	[BlockTypes.consolelog]: emitConsoleLog,
	[BlockTypes.httprequest]: emitHttpRequest,
	[BlockTypes.httpGetHeader]: emitGetHttpHeader,
	[BlockTypes.httpSetHeader]: emitSetHttpHeader,
	[BlockTypes.httpGetParam]: emitGetHttpParam,
	[BlockTypes.httpGetCookie]: emitGetHttpCookie,
	[BlockTypes.httpSetCookie]: emitSetHttpCookie,
	[BlockTypes.httpGetRequestBody]: emitGetHttpRequestBody,
	[BlockTypes.db_getsingle]: emitGetSingleDb,
	[BlockTypes.db_getall]: emitGetAllDb,
	[BlockTypes.db_insert]: emitInsertDb,
	[BlockTypes.db_insertbulk]: emitInsertBulkDb,
	[BlockTypes.db_update]: emitUpdateDb,
	[BlockTypes.db_delete]: emitDeleteDb,
	[BlockTypes.db_native]: emitNativeDb,
	[BlockTypes.db_transaction]: emitTransactionDb,
	[BlockTypes.cloudLogs]: emitCloudLogs,
};

/** helpers the generated code calls as `lib.x` — anything too big to inline */
export const compilerLib = {
	log: runConsoleLog,
	httpRequest: runHttpRequest,
	isoDate: (value: any) => dayjs(value).toISOString(),
	scope: scopeFor,
	/** Number() with the block's documented fallback for NaN */
	num: (value: any, fallback: number) => {
		const parsed = Number(value);
		return Number.isNaN(parsed) ? fallback : parsed;
	},
	dbGetSingle: runGetSingleDb,
	dbGetAll: runGetAllDb,
	dbInsert: runInsertDb,
	dbInsertBulk: runInsertBulkDb,
	dbUpdate: runUpdateDb,
	dbDelete: runDeleteDb,
	dbNative: runNativeDb,
	dbTransaction: runTransactionDb,
	cloudLog: runCloudLog,
	invoke: invokeCustomBlock,
	invokeAsync: invokeCustomBlockAsync,
	enqueue: enqueueCustomBlock,
};
