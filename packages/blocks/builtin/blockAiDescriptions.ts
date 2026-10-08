import type { BlockTypes } from "../blockTypes";
import { arrayOperationsAiDescription } from "./arrayOperations";
import { countDbAiDescription } from "./db/count";
import { deleteDbAiDescription } from "./db/delete";
import { existsDbAiDescription } from "./db/exists";
import { getAllDbAiDescription } from "./db/getAll";
import { getSingleDbAiDescription } from "./db/getSingle";
import { insertDbAiDescription } from "./db/insert";
import { insertBulkAiDescription } from "./db/insertBulk";
import { nativeDbAiDescription } from "./db/native";
import { rollbackDbAiDescription } from "./db/rollback";
import { transactionDbAiDescription } from "./db/transaction";
import { updateDbAiDescription } from "./db/update";
import { entrypointAiDescription } from "./entrypoint";
import { errorHandlerAiDescription } from "./errorHandler";
import { getVarAiDescription } from "./getVar";
import { getCookieAiDescription } from "./http/getHttpCookie";
import { getHttpHeaderAiDescription } from "./http/getHttpHeader";
import { getHttpParamAiDescription } from "./http/getHttpParam";
import { getHttpRequestBodyAiDescription } from "./http/getHttpRequestBody";
import { setCookieAiDescription } from "./http/setHttpCookie";
import { setHeaderAiDescription } from "./http/setHttpHeader";
import { httpRequestAiDescription } from "./httpRequest";
import { ifConditionAiDescription } from "./if";
import { jsRunnerAiDescription } from "./jsRunner";
import { kvOperationsAiDescription } from "./kv/operations";
import { kvRawAiDescription } from "./kv/rawConnection";
import { cloudLogsAiDescription } from "./log/cloudLogs";
import { consoleAiDescription } from "./log/console";
import { forLoopAiDescription } from "./loops/for";
import { foreachLoopAiDescription } from "./loops/foreach";
import { orchestratorAiDescription } from "./orchestrator";
import { sendMessageAiDescription } from "./queue/sendMessage";
import { responseAiDescription } from "./response";
import { retryAiDescription } from "./retry";
import { setVarBlockAiDescription } from "./setVar";
import { stickyNoteBlockAiDescription } from "./stickyNote";
import { switchAiDescription } from "./switch";
import { transformBlockAiDescription } from "./transformer";

/** What an agent is told about a built-in block (get_block_schemas). */
export type BlockAiDescription = {
	name: BlockTypes;
	description: string;
	jsonSchema: string;
	handleInfo?: string;
	/** what the block hands on: the next block's `input` */
	output: string;
	/** one valid `data`; `blockAiDescriptions.spec.ts` parses it with the block's schema */
	example: Record<string, unknown>;
};

export const blockAiDescriptions: BlockAiDescription[] = [
	arrayOperationsAiDescription,
	entrypointAiDescription,
	getVarAiDescription,
	httpRequestAiDescription,
	ifConditionAiDescription,
	jsRunnerAiDescription,
	responseAiDescription,
	setVarBlockAiDescription,
	stickyNoteBlockAiDescription,
	transformBlockAiDescription,
	deleteDbAiDescription,
	getAllDbAiDescription,
	getSingleDbAiDescription,
	existsDbAiDescription,
	countDbAiDescription,
	insertDbAiDescription,
	insertBulkAiDescription,
	nativeDbAiDescription,
	transactionDbAiDescription,
	rollbackDbAiDescription,
	updateDbAiDescription,
	kvRawAiDescription,
	kvOperationsAiDescription,
	sendMessageAiDescription,
	retryAiDescription,
	getCookieAiDescription,
	getHttpHeaderAiDescription,
	getHttpParamAiDescription,
	getHttpRequestBodyAiDescription,
	setCookieAiDescription,
	setHeaderAiDescription,
	consoleAiDescription,
	forLoopAiDescription,
	foreachLoopAiDescription,
	orchestratorAiDescription,
	switchAiDescription,
	cloudLogsAiDescription,
	errorHandlerAiDescription,
];
