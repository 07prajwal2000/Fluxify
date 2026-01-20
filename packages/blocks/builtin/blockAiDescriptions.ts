import { arrayOperationsAiDescription } from "./arrayOperations";
import { entrypointAiDescription } from "./entrypoint";
import { getVarAiDescription } from "./getVar";
import { httpRequestAiDescription } from "./httpRequest";
import { ifConditionAiDescription } from "./if";
import { jsRunnerAiDescription } from "./jsRunner";
import { responseAiDescription } from "./response";
import { setVarBlockAiDescription } from "./setVar";
import { stickyNoteBlockAiDescription } from "./stickyNote";
import { transformBlockAiDescription } from "./transformer";
import { deleteDbAiDescription } from "./db/delete";
import { getAllDbAiDescription } from "./db/getAll";
import { getSingleDbAiDescription } from "./db/getSingle";
import { insertDbAiDescription } from "./db/insert";
import { insertBulkAiDescription } from "./db/insertBulk";
import { nativeDbAiDescription } from "./db/native";
import { transactionDbAiDescription } from "./db/transaction";
import { updateDbAiDescription } from "./db/update";
import { getCookieAiDescription } from "./http/getHttpCookie";
import { getHttpHeaderAiDescription } from "./http/getHttpHeader";
import { getHttpParamAiDescription } from "./http/getHttpParam";
import { getHttpRequestBodyAiDescription } from "./http/getHttpRequestBody";
import { setCookieAiDescription } from "./http/setHttpCookie";
import { setHeaderAiDescription } from "./http/setHttpHeader";
import { consoleAiDescription } from "./log/console";
import { forLoopAiDescription } from "./loops/for";
import { foreachLoopAiDescription } from "./loops/foreach";

export const blockAiDescriptions = [
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
  insertDbAiDescription,
  insertBulkAiDescription,
  nativeDbAiDescription,
  transactionDbAiDescription,
  updateDbAiDescription,
  getCookieAiDescription,
  getHttpHeaderAiDescription,
  getHttpParamAiDescription,
  getHttpRequestBodyAiDescription,
  setCookieAiDescription,
  setHeaderAiDescription,
  consoleAiDescription,
  forLoopAiDescription,
  foreachLoopAiDescription,
];
