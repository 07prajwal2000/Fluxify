import underscore from "underscore";
import jwt from "jsonwebtoken";
import { getCookie, setCookie } from "hono/cookie";
import dayjs from "dayjs";
import dayjsUtc from "dayjs/plugin/utc";
import {
	AbstractLogger,
	ConsoleLoggerProvider,
	EmptyLoggerProvider,
	HttpClient,
	HttpRoute,
	HttpRouteParser,
} from "@fluxify/lib";
import {
	Context as BlockContext,
	BlockOutput,
	ContextVarsType,
} from "@fluxify/blocks";
import { Context } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { JsVM } from "@fluxify/lib";
import { startBlocksExecution } from "../../loaders/blocksLoader";
import { getAppConfig } from "../../loaders/appconfigLoader";
import { parseRequestSchema } from "../../lib/schemaParser";
import { createObservabilityLogger, DbFactory } from "@fluxify/adapters";
import {
	dbIntegrationsCache,
	observabilityIntegrationsCache,
} from "../../loaders/integrationsLoader";
import * as zodLib from "zod";
import { projectSettingsCache } from "../../loaders/projectSettingsLoader";

export type HandleRequestType = {
	data?: any;
	status: ContentfulStatusCode;
};

export const RESPONSE_TIMEOUT = 4 * 1000;

export async function handleRequest(
	ctx: Context,
	parser: HttpRouteParser,
): Promise<HandleRequestType> {
	const path = parser.getRouteId(
		ctx.req.path,
		ctx.req.method as HttpRoute["method"],
	);
	if (!path) {
		return {
			status: 404,
			data: {
				message: "Route not found",
			},
		};
	}

	let requestBody = await getRequestBody(ctx);
	const httpClient = createHttpClient();
	const vars = setupContextVars(
		ctx,
		requestBody,
		path.id,
		httpClient,
		path.projectId,
		path.routeParams,
	);
	const vm = createJsVM(vars);

	if (path.bodySchema && Object.keys(path.bodySchema).length > 0) {
		const result = await parseRequestSchema(path.bodySchema, requestBody, { vm });
		if (!result.success) {
			return {
				status: 400,
				data: { message: "Body validation failed", errors: result.errors },
			};
		}
	}
	
	if (path.querySchema && Object.keys(path.querySchema).length > 0) {
		const result = await parseRequestSchema(path.querySchema, ctx.req.query(), { vm, coerce: true });
		if (!result.success) {
			return {
				status: 400,
				data: { message: "Query validation failed", errors: result.errors },
			};
		}
	}
	
	if (path.paramsSchema && Object.keys(path.paramsSchema).length > 0) {
		const result = await parseRequestSchema(path.paramsSchema, path.routeParams || {}, { vm, coerce: true });
		if (!result.success) {
			return {
				status: 400,
				data: { message: "Path parameters validation failed", errors: result.errors },
			};
		}
	}

	const dbFactory = createDbFactory(vm);
	const context = createContext(
		path,
		ctx,
		requestBody,
		vm,
		vars,
		dbFactory,
		httpClient,
	);

	const executionResult = await startBlocksExecution(
		{
			projectId: path.projectId!,
			routeId: path.id,
			projectName: path.projectName,
		},
		context,
	);
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
		status:
			executionResult.output?.httpCode || (executionResult.error ? 500 : 200),
		data:
			executionResult.output?.body || // has output from previous blocks which passed to response block
			executionResult?.output || // has output from previous blocks which didn't pass (or no response block) to response block
			(!executionResult.successful
				? { error: executionResult.error?.toString() || "Unknown error" }
				: "NO RESULT"),
	};
}

function createContext(
	path: { id: string; routeParams?: Record<string, string>; projectId: string },
	ctx: Context<any, any, {}>,
	requestBody: any,
	vm: JsVM,
	vars: ContextVarsType & Record<string, any>,
	dbFactory: DbFactory,
	httpClient: HttpClient,
): BlockContext {
	return {
		apiId: path.id,
		route: ctx.req.path,
		projectId: path.projectId,
		requestBody,
		vm,
		vars,
		dbFactory,
		httpClient,
		stopper: {
			timeoutEnd: 0,
			duration: RESPONSE_TIMEOUT,
		},
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
	routeId: string,
	httpClient: HttpClient,
	projectId: string,
	params?: Record<string, string>,
): BlockContext["vars"] {
	let logger: AbstractLogger = null!;

	const projectSettings = projectSettingsCache[projectId];
	if ("settings.ai.loggerConnectionId" in projectSettings) {
		const config =
			observabilityIntegrationsCache[
				projectSettings["settings.ai.loggerConnectionId"]
			];
		if (!!config) {
			config.projectId = projectId;
			config.routeId = routeId;
			logger = createObservabilityLogger(config["variant"], config)!;
		} else {
			logger = new ConsoleLoggerProvider(routeId);
		}
	}

	return {
		jwt: {
			decode(token, options) {
				return jwt.decode(token, options) as Record<string, string>;
			},
			sign(payload, secretKey, options) {
				return jwt.sign(payload, secretKey, options);
			},
			verify(token, secretKey, options) {
				try {
					const payload = jwt.verify(token, secretKey, options) as Record<
						string,
						string
					>;
					return { payload, success: true };
				} catch (error) {
					return { payload: null, success: false };
				}
			},
		},
		libs: {
			dayjs: dayjs.extend(dayjsUtc),
			_: underscore,
			zod: zodLib,
		},
		logger,
		getCookie(key) {
			return getCookie(ctx, key) || "";
		},
		getConfig(key) {
			return getAppConfig(projectId, key);
		},
		setCookie(name, options) {
			setCookie(ctx, name, options?.value.toString() || "", {
				domain: options?.domain,
				path: options?.path,
				expires: new Date(options?.expiry),
				httpOnly: options?.httpOnly,
				secure: options?.secure,
				sameSite: options?.samesite || "Strict",
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
		httpClient,
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
