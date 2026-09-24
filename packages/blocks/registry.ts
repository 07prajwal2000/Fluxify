import dayjs from "dayjs";
import { BlockTypes } from "./blockTypes";
import { emitArrayOps } from "./builtin/arrayOperations";
import {
	enqueueCustomBlock,
	invokeCustomBlock,
	invokeCustomBlockAsync,
} from "./builtin/customBlock";
import { emitDeleteDb, runDeleteDb } from "./builtin/db/delete";
import { emitExistsDb } from "./builtin/db/exists";
import { emitGetAllDb, runGetAllDb } from "./builtin/db/getAll";
import { emitGetSingleDb, runGetSingleDb } from "./builtin/db/getSingle";
import { emitInsertDb, runInsertDb } from "./builtin/db/insert";
import { emitInsertBulkDb, runInsertBulkDb } from "./builtin/db/insertBulk";
import { emitNativeDb, runNativeDb } from "./builtin/db/native";
import { emitRollbackDb } from "./builtin/db/rollback";
import { emitTransactionDb, runTransactionDb, TransactionRollback } from "./builtin/db/transaction";
import { emitUpdateDb, runUpdateDb } from "./builtin/db/update";
import { emitEntrypoint } from "./builtin/entrypoint";
import { emitGetVar } from "./builtin/getVar";
import { emitGetHttpCookie } from "./builtin/http/getHttpCookie";
import { emitGetHttpHeader } from "./builtin/http/getHttpHeader";
import { emitGetHttpParam } from "./builtin/http/getHttpParam";
import { emitGetHttpRequestBody } from "./builtin/http/getHttpRequestBody";
import { emitSetHttpCookie } from "./builtin/http/setHttpCookie";
import { emitSetHttpHeader } from "./builtin/http/setHttpHeader";
import { emitHttpRequest, runHttpRequest } from "./builtin/httpRequest";
import { emitIf } from "./builtin/if";
import { emitJsRunner } from "./builtin/jsRunner";
import { emitKvOperations, runKvOperations } from "./builtin/kv/operations";
import { emitKvRaw, runKvRaw } from "./builtin/kv/rawConnection";
import { emitCloudLogs, runCloudLog } from "./builtin/log/cloudLogs";
import { emitConsoleLog, runConsoleLog } from "./builtin/log/console";
import { emitForLoop } from "./builtin/loops/for";
import { emitForEachLoop } from "./builtin/loops/foreach";
import { emitOrchestrator } from "./builtin/orchestrator";
import { emitResponse } from "./builtin/response";
import { emitSetVar } from "./builtin/setVar";
import { emitSwitch } from "./builtin/switch";
import { emitTransformer } from "./builtin/transformer";
import {
	cancelSchedule,
	emitTriggerWorkflow,
	fireWorkflow,
	scheduleWorkflow,
} from "./builtin/triggerWorkflow";
// type-only: the compiler imports this module for its tables, so a value
// import back the other way would close the cycle
import type { EmitNode } from "./compiler";
import { scopeFor } from "./scope";

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
	[BlockTypes.orchestrator]: emitOrchestrator,
	[BlockTypes.switch]: emitSwitch,
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
	[BlockTypes.db_exists]: emitExistsDb,
	[BlockTypes.db_getall]: emitGetAllDb,
	[BlockTypes.db_insert]: emitInsertDb,
	[BlockTypes.db_insertbulk]: emitInsertBulkDb,
	[BlockTypes.db_update]: emitUpdateDb,
	[BlockTypes.db_delete]: emitDeleteDb,
	[BlockTypes.db_native]: emitNativeDb,
	[BlockTypes.db_transaction]: emitTransactionDb,
	[BlockTypes.db_rollback]: emitRollbackDb,
	[BlockTypes.kv_raw]: emitKvRaw,
	[BlockTypes.kv_operations]: emitKvOperations,
	[BlockTypes.cloudLogs]: emitCloudLogs,
	[BlockTypes.triggerWorkflow]: emitTriggerWorkflow,
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
	TransactionRollback,
	kvRaw: runKvRaw,
	kvOperations: runKvOperations,
	cloudLog: runCloudLog,
	invoke: invokeCustomBlock,
	invokeAsync: invokeCustomBlockAsync,
	enqueue: enqueueCustomBlock,
	fireWorkflow,
	scheduleWorkflow,
	cancelSchedule,
};
