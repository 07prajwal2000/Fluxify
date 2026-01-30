import { getCookie, setCookie } from "hono/cookie";
import { HttpClient, HttpRoute, HttpRouteParser } from "@fluxify/lib";
import { Context as BlockContext, BlockOutput, ContextVarsType } from "@fluxify/blocks";
import { Context } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { JsVM } from "@fluxify/lib";
import { startBlocksExecution } from "../../loaders/blocksLoader";
import { appConfigCache } from "../../loaders/appconfigLoader";
import { DbFactory } from "@fluxify/adapters";
import { dbIntegrationsCache } from "../../loaders/integrationsLoader";

export type HandleRequestType = {
  data?: any;
  status: ContentfulStatusCode;
};

export const RESPONSE_TIMEOUT = 4 * 1000;

export async function handleRequest(
  ctx: Context,
  parser: HttpRouteParser,
): Promise<HandleRequestType> {
  const pathId = parser.getRouteId(
    ctx.req.path,
    ctx.req.method as HttpRoute["method"],
  );
  if (!pathId) {
    return {
      status: 404,
      data: {
        message: "Route not found",
      },
    };
  }

  let requestBody = await getRequestBody(ctx);
  const vars = setupContextVars(ctx, requestBody, pathId.routeParams);
  const vm = createJsVM(vars);
  const dbFactory = createDbFactory(vm);
  const context = createContext(pathId, ctx, requestBody, vm, vars, dbFactory);
  const timeoutId = setTimeout(() => {
    context.abortController.abort();
  }, RESPONSE_TIMEOUT);

  const executionResult = await startBlocksExecution(pathId.id, context);
  clearTimeout(timeoutId);
  if (executionResult) {
    return parseResult(executionResult);
  }
  return {
    status: 500,
    data: {
      message: "Internal server error",
    },
  };
}

function parseResult(executionResult: BlockOutput) {
  return {
    status: executionResult.output?.httpCode || (executionResult.error ? 500 : 200),
    data:
      executionResult.output?.body || executionResult?.output || (!executionResult.successful ? ({error: executionResult.error?.toString() || "Unknown error"}) : "NO RESULT"),
  };
}

function createContext(
  pathId: { id: string; routeParams?: Record<string, string> },
  ctx: Context<any, any, {}>,
  requestBody: any,
  vm: JsVM,
  vars: ContextVarsType & Record<string, any>,
  dbFactory: DbFactory,
): BlockContext {
  return {
    apiId: pathId.id,
    route: ctx.req.path,
    requestBody,
    vm,
    vars,
    dbFactory,
    httpClient: createHttpClient(),
    abortController: new AbortController(),
    stopper: {
      timeoutEnd: 0,
      duration: RESPONSE_TIMEOUT
    }
  };
}

function createHttpClient() {
  return new HttpClient();
}

function createDbFactory(vm: JsVM) {
  return new DbFactory(vm, dbIntegrationsCache);
}

function setupContextVars(
  ctx: Context,
  body: any,
  params?: Record<string, string>,
): BlockContext["vars"] {
  return {
    getCookie(key) {
      return getCookie(ctx, key) || "";
    },
    getConfig(key) {
      return appConfigCache[key];
    },
    setCookie(name, options) {
      setCookie(ctx, name, options?.value || "", {
        domain: options?.domain,
        path: options?.path,
        expires: options?.expiry as Date,
        httpOnly: options?.httpOnly,
        secure: options?.secure,
        sameSite: options?.samesite,
      });
    },
    getHeader(key) {
      return ctx.req.header(key) || "";
    },
    getQueryParam(key) {
      return ctx.req.query(key) || "";
    },
    getRequestBody() {
      return body;
    },
    getRouteParam(key) {
      return params?.[key] || "";
    },
    httpRequestMethod: ctx.req.method,
    httpRequestRoute: ctx.req.path,
    setHeader(key, value) {
      ctx.header(key, value);
    },
  };
}

function createJsVM(vars: Record<string, any>) {
  const vm = new JsVM(vars);
  return vm;
}

async function getRequestBody(ctx: Context) {
  const method = ctx.req.method;
  if (method == "POST" || method == "PUT") {
    const contentType = ctx.req.header("Content-Type");
    if (contentType === "application/json") {
      return await ctx.req.json();
    }
    if (contentType === "application/x-www-form-urlencoded") {
      return await ctx.req.formData();
    }
    return await ctx.req.text();
  }
  return null;
}
