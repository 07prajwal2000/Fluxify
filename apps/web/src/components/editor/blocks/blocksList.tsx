import { BlockTypes } from "@/types/block";
import Entrypoint from "./entrypoint";
import { NodeTypes } from "@xyflow/react";
import IfCondition from "./builtin/if";
import Response from "./response";
import JsRunner from "./builtin/jsRunner";
import SetVar from "./builtin/setVar";
import GetVar from "./builtin/getVar";
import Transformer from "./builtin/transformer";
import ArrayOperations from "./builtin/arrayOperations";
import HttpRequest from "./builtin/httpRequest";
import Forloop from "./builtin/forloop";
import GetCookie from "./builtin/http/getCookie";
import SetCookie from "./builtin/http/setCookie";
import ForeachLoop from "./builtin/foreachLoop";
import GetHeader from "./builtin/http/getHeader";
import SetHeader from "./builtin/http/setHeader";
import GetParam from "./builtin/http/getParam";
import GetRequestBody from "./builtin/http/getRequestBody";
import GetSingle from "./builtin/database/getSingle";
import GetAll from "./builtin/database/getAll";
import Insert from "./builtin/database/insert";
import InsertBulk from "./builtin/database/insertBulk";
import Update from "./builtin/database/update";
import Delete from "./builtin/database/delete";
import Transaction from "./builtin/database/transaction";
import Native from "./builtin/database/native";
import Console from "./builtin/logging/console";
import StickyNote from "./builtin/stickyNote";
import ErrorHandlerBlock from "./builtin/errorHandler";

const blocksList: NodeTypes = {
  [BlockTypes.entrypoint]: Entrypoint,
  [BlockTypes.if]: IfCondition,
  [BlockTypes.response]: Response,
  [BlockTypes.jsrunner]: JsRunner,
  [BlockTypes.setvar]: SetVar,
  [BlockTypes.getvar]: GetVar,
  [BlockTypes.transformer]: Transformer,
  [BlockTypes.arrayops]: ArrayOperations,
  [BlockTypes.httprequest]: HttpRequest,
  [BlockTypes.httpgetcookie]: GetCookie,
  [BlockTypes.httpsetcookie]: SetCookie,
  [BlockTypes.forloop]: Forloop,
  [BlockTypes.foreachloop]: ForeachLoop,
  [BlockTypes.consolelog]: Console,
  [BlockTypes.httpgetheader]: GetHeader,
  [BlockTypes.httpsetheader]: SetHeader,
  [BlockTypes.httpgetparam]: GetParam,
  [BlockTypes.httpgetrequestbody]: GetRequestBody,
  [BlockTypes.db_getsingle]: GetSingle,
  [BlockTypes.db_getall]: GetAll,
  [BlockTypes.db_insert]: Insert,
  [BlockTypes.db_insertbulk]: InsertBulk,
  [BlockTypes.db_update]: Update,
  [BlockTypes.db_delete]: Delete,
  [BlockTypes.db_transaction]: Transaction,
  [BlockTypes.db_native]: Native,
  [BlockTypes.stickynote]: StickyNote,
  [BlockTypes.errorHandler as string]: ErrorHandlerBlock,
};

export { blocksList };
