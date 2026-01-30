import { BlockTypes } from "@/types/block";
import { stickyNotesSchema } from "@fluxify/blocks";
import z from "zod";

export function createBlockData(block: BlockTypes) {
  switch (block) {
    case BlockTypes.httprequest:
      return {
        url: "",
        method: "GET",
        headers: {},
        body: {},
        useParam: false,
      };
    case BlockTypes.if:
      return {
        conditions: [],
      };
    case BlockTypes.httpgetheader:
      return { name: "" };
    case BlockTypes.httpsetheader:
      return {
        name: "",
        value: "",
      };
    case BlockTypes.httpgetparam:
      return {
        name: "",
        source: "query",
      };
    case BlockTypes.httpgetcookie:
      return { name: "" };
    case BlockTypes.httpsetcookie:
      return {
        name: "",
        value: "",
        domain: "",
        path: "",
        expiry: new Date(),
        httpOnly: true,
        secure: true,
        samesite: "Strict",
      };
    case BlockTypes.httpgetrequestbody:
      return {};
    case BlockTypes.forloop:
      return {
        block: "",
        start: 0,
        end: 10,
        step: 1,
      };
    case BlockTypes.foreachloop:
      return {
        block: "",
        values: [],
        useParam: false,
      };
    case BlockTypes.transformer:
      return {
        fieldMap: {},
        js: "",
        useJs: false,
      };
    case BlockTypes.setvar:
      return {
        key: "",
        value: "",
      };
    case BlockTypes.getvar:
      return { key: "" };
    case BlockTypes.consolelog:
      return {
        message: "",
        level: "info",
      };
    case BlockTypes.jsrunner:
      return {
        value: "",
      };
    case BlockTypes.response:
      return { httpCode: "200" };
    case BlockTypes.arrayops:
      return {
        operation: "push",
        value: "",
        useParamAsInput: false,
        datasource: "",
      };
    case BlockTypes.db_getsingle:
      return {
        connection: "",
        tableName: "",
        conditions: [],
      };
    case BlockTypes.db_getall:
      return {
        connection: "",
        tableName: "",
        conditions: [],
        limit: 10,
        offset: 0,
        sort: {
          attribute: "id",
          direction: "asc",
        },
      };
    case BlockTypes.db_delete:
      return {
        connection: "",
        tableName: "",
        conditions: [],
      };
    case BlockTypes.db_insert:
      return {
        connection: "",
        tableName: "",
        data: {
          source: "raw",
          value: {},
        },
        useParam: false,
      };
    case BlockTypes.db_insertbulk:
      return {
        connection: "",
        tableName: "",
        data: {
          source: "raw",
          value: [],
        },
        useParam: false,
      };
    case BlockTypes.db_update:
      return {
        connection: "",
        tableName: "",
        data: {
          source: "raw",
          value: {},
        },
        conditions: [],
        useParam: false,
      };
    case BlockTypes.db_native:
      return {
        js: "",
        connection: "",
      };
    case BlockTypes.db_transaction:
      return {
        connection: "",
        executor: "",
      };
    case BlockTypes.stickynote:
      return {
        notes: "",
        color: "yellow",
        size: {
          width: 100,
          height: 100,
        },
      } as z.infer<typeof stickyNotesSchema>;
    default:
      return {};
  }
}

export function getHumanReadableBlockName(blockType: BlockTypes) {
  switch (blockType) {
    case BlockTypes.entrypoint:
      return "Entrypoint";
    case BlockTypes.errorHandler:
      return "Error Handler";
    case BlockTypes.httprequest:
      return "HTTP Request";
    case BlockTypes.if:
      return "If";
    case BlockTypes.httpgetheader:
      return "HTTP Get Header";
    case BlockTypes.httpsetheader:
      return "HTTP Set Header";
    case BlockTypes.httpgetparam:
      return "HTTP Get Param";
    case BlockTypes.httpgetcookie:
      return "HTTP Get Cookie";
    case BlockTypes.httpsetcookie:
      return "HTTP Set Cookie";
    case BlockTypes.httpgetrequestbody:
      return "HTTP Get Request Body";
    case BlockTypes.forloop:
      return "For Loop";
    case BlockTypes.foreachloop:
      return "Foreach Loop";
    case BlockTypes.transformer:
      return "Transformer";
    case BlockTypes.setvar:
      return "Set Variable";
    case BlockTypes.getvar:
      return "Get Variable";
    case BlockTypes.consolelog:
      return "Console Log";
    case BlockTypes.jsrunner:
      return "JS Runner";
    case BlockTypes.response:
      return "Response";
    case BlockTypes.arrayops:
      return "Array Operations";
    case BlockTypes.db_getsingle:
      return "DB Get Single";
    case BlockTypes.db_getall:
      return "DB Get All";
    case BlockTypes.db_delete:
      return "DB Delete";
    case BlockTypes.db_insert:
      return "DB Insert";
    case BlockTypes.db_insertbulk:
      return "DB Insert Bulk";
    case BlockTypes.db_update:
      return "DB Update";
    case BlockTypes.db_native:
      return "DB Native";
    case BlockTypes.db_transaction:
      return "DB Transaction";
    case BlockTypes.stickynote:
      return "Sticky Note";
    default:
      return "Unknown";
  }
}
