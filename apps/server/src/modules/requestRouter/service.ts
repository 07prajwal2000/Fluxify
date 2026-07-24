import underscore from "underscore";
import jwt from "jsonwebtoken";
import { getCookie, setCookie } from "hono/cookie";
import dayjs from "dayjs";
import dayjsUtc from "dayjs/plugin/utc";
import {
	AbstractLogger,
	ConsoleLoggerProvider,
	HttpClient,
	HttpRoute,
	HttpRouteParser,
} from "@fluxify/lib";
import {
	Context as BlockContext,
	BlockOutput,
	ContextVarsType,
	TriggerContext,
} from "@fluxify/blocks";
import { Context } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { JsVM } from "@fluxify/lib";
import { startBlocksExecution } from "../../loaders/blocksLoader";
import { getAppConfig } from "../../loaders/appconfigLoader";
import { parseRequestSchema, ValidationError } from "../../lib/schemaParser";
import { createObservabilityLogger, DbFactory } from "@fluxify/adapters";
import {
	dbIntegrationsCache,
	observabilityIntegrationsCache,
} from "../../loaders/integrationsLoader";
import * as zodLib from "zod";
import { projectSettingsCache } from "../../loaders/projectSettingsLoader";
import type { RequestEnvelope, RequestPayload } from "./types";

export type HandleRequestType = {
	data?: any;
	status: ContentfulStatusCode;
};

// defined in ./types so it has no import cycle with the envelope; re-exported
// here because the test-suites runner imports it from this module.
export type { RequestOverrides } from "./types";
import type { RequestOverrides } from "./types";

export const RESPONSE_TIMEOUT = 4 * 1000;

/** Default origin for in-process callers (test-suite runner) that predate the envelope. */
const DEFAULT_TRIGGER: TriggerContext = {
	kind: "route",
	source: "http",
	reply: "sync",
};

/**
 * HTTP transport adapter: turn an incoming Hono request into a generic
 * envelope. This is the ONLY Hono-aware ingestion path; a NATS/BullMQ consumer
 * would build the same envelope from its message and call dispatch() directly.
 * `reply` is opt-in async via header so schedulers/crons can fire-and-forget.
 */
export async function envelopeFromHttp(ctx: Context): Promise<RequestEnvelope> {
	return {
		trigger: {
			kind: "route",
			source: "http",
			reply: ctx.req.header("x-fluxify-reply") === "async" ? "async" : "sync",
			id: ctx.req.header("x-fluxify-id"),
		},
		payload: {
			method: ctx.req.method,
			path: ctx.req.path,
			headers: ctx.req.header(),
			query: ctx.req.query(),
			body: await getRequestBody(ctx),
		},
	};
}

/**
 * Transport-agnostic entry point of the worker. Matches the route from the
 * envelope's payload and runs it. `httpCtx` is only for HTTP side-effects
 * (response cookies/headers); non-HTTP sources omit it and those calls no-op.
 */
export async function dispatch(
	env: RequestEnvelope,
	parser: HttpRouteParser,
	httpCtx?: Context,
): Promise<HandleRequestType> {
	const { payload, trigger, overrides } = env;
	const path = parser.getRouteId(
		payload.path,
		payload.method as HttpRoute["method"],
	);
	if (!path) {
		return {
			status: 404,
			data: {
				message: "Route not found",
			},
		};
	}

	return executeRouteInternal(
		{
			id: path.id,
			projectId: path.projectId!,
			projectName: path.projectName!,
			routeParams: path.routeParams,
			bodySchema: path.bodySchema,
			querySchema: path.querySchema,
			paramsSchema: path.paramsSchema,
		},
		{
			method: payload.method,
			path: payload.path,
			headers: payload.headers,
			query: payload.query,
			body: payload.body,
			params: path.routeParams || payload.params || {},
		},
		httpCtx,
		overrides,
		trigger,
	);
}

export async function executeRouteInternal(
	routeInfo: {
		id: string;
		projectId: string;
		projectName: string;
		routeParams?: Record<string, string>;
		bodySchema?: any;
		querySchema?: any;
		paramsSchema?: any;
	},
	requestData: {
		method: string;
		path: string;
		headers: Record<string, string>;
		query: Record<string, string | string[]>;
		body: any;
		params: Record<string, string>;
	},
	ctx?: Context,
	overrides?: RequestOverrides,
	trigger: TriggerContext = DEFAULT_TRIGGER,
): Promise<HandleRequestType> {
	const httpClient = createHttpClient();
	const vars = setupContextVars(
		ctx,
		requestData,
		routeInfo.id,
		httpClient,
		routeInfo.projectId,
		overrides,
		trigger,
	);
	const vm = createJsVM(vars);

	if (routeInfo.bodySchema && Object.keys(routeInfo.bodySchema).length > 0) {
		const result = await parseRequestSchema(
			routeInfo.bodySchema,
			requestData.body,
			{
				vm,
			},
		);
		if (!result.success) {
			return {
				status: 400,
				data: { message: "Body validation failed", errors: result.errors },
			};
		}
	}

	if (routeInfo.querySchema && Object.keys(routeInfo.querySchema).length > 0) {
		const result = await parseRequestSchema(
			routeInfo.querySchema,
			requestData.query,
			{
				vm,
				coerce: true,
			},
		);
		if (!result.success) {
			return {
				status: 400,
				data: { message: "Query validation failed", errors: result.errors },
			};
		}
	}

	if (
		routeInfo.paramsSchema &&
		Object.keys(routeInfo.paramsSchema).length > 0
	) {
		const result = await parseRequestSchema(
			routeInfo.paramsSchema,
			requestData.params,
			{ vm, coerce: true },
		);
		if (!result.success) {
			return {
				status: 400,
				data: {
					message: "Path parameters validation failed",
					errors: result.errors,
				},
			};
		}
	}

	const dbFactory = createDbFactory(vm, overrides?.integrations);
	const context = createContext(
		routeInfo,
		requestData,
		vm,
		vars,
		dbFactory,
		httpClient,
		trigger,
	);

	const executionResult = await startBlocksExecution(
		{
			projectId: routeInfo.projectId,
			routeId: routeInfo.id,
			projectName: routeInfo.projectName,
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
	routeInfo: { id: string; projectId: string },
	requestData: { path: string; body: any },
	vm: JsVM,
	vars: ContextVarsType & Record<string, any>,
	dbFactory: DbFactory,
	httpClient: HttpClient,
	trigger: TriggerContext,
): BlockContext {
	return {
		apiId: routeInfo.id,
		route: requestData.path,
		projectId: routeInfo.projectId,
		requestBody: requestData.body,
		vm,
		vars,
		dbFactory,
		httpClient,
		trigger,
		stopper: {
			timeoutEnd: 0,
			duration: RESPONSE_TIMEOUT,
		},
	};
}

function createHttpClient() {
	return new HttpClient();
}

function createDbFactory(
	vm: JsVM,
	integrationOverrides?: Array<{ existingId: string; newId: string }>,
) {
	if (!integrationOverrides || integrationOverrides.length === 0) {
		return new DbFactory(vm, dbIntegrationsCache);
	}

	const customDbCache = { ...dbIntegrationsCache };
	for (const override of integrationOverrides) {
		if (dbIntegrationsCache[override.newId]) {
			customDbCache[override.existingId] = dbIntegrationsCache[override.newId];
		}
	}
	return new DbFactory(vm, customDbCache);
}

function setupContextVars(
	ctx: Context | undefined,
	requestData: {
		method: string;
		path: string;
		headers: Record<string, string>;
		query: Record<string, string | string[]>;
		body: any;
		params: Record<string, string>;
	},
	routeId: string,
	httpClient: HttpClient,
	projectId: string,
	overrides?: RequestOverrides,
	trigger: TriggerContext = DEFAULT_TRIGGER,
): BlockContext["vars"] {
	let logger: AbstractLogger = null!;

	const projectSettings = projectSettingsCache[projectId];
	if (projectSettings && "settings.ai.loggerConnectionId" in projectSettings) {
		let connectionId = projectSettings["settings.ai.loggerConnectionId"];

		// Apply integration override for logger if present
		if (overrides?.integrations) {
			const override = overrides.integrations.find(
				(o) => o.existingId === connectionId,
			);
			if (override) {
				connectionId = override.newId;
			}
		}

		const config = observabilityIntegrationsCache[connectionId];
		if (!!config) {
			config.projectId = projectId;
			config.routeId = routeId;
			logger = createObservabilityLogger(config["variant"], config)!;
		} else {
			logger = new ConsoleLoggerProvider(routeId);
		}
	} else {
		logger = new ConsoleLoggerProvider(routeId);
	}

	return {
		ValidationError: ValidationError,
		// origin of this execution (route/job/cron, http/nats/bullmq, sync/async)
		// so JS-runtime blocks can branch: `trigger.kind === "cron"`
		trigger,
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
			return ctx ? getCookie(ctx, key) || "" : "";
		},
		getConfig(key) {
			if (overrides?.appConfigs) {
				const override = overrides.appConfigs.find((c) => c.key === key);
				if (override) return override.value;
			}
			return getAppConfig(projectId, key);
		},
		setCookie(name, options) {
			if (ctx) {
				setCookie(ctx, name, options?.value.toString() || "", {
					domain: options?.domain,
					path: options?.path,
					expires: new Date(options?.expiry),
					httpOnly: options?.httpOnly,
					secure: options?.secure,
					sameSite: options?.samesite || "Strict",
				});
			}
		},
		getHeader(key) {
			const lowerKey = key.toLowerCase();
			for (const k in requestData.headers) {
				if (k.toLowerCase() === lowerKey) {
					return requestData.headers[k] || "";
				}
			}
			return "";
		},
		getQueryParam(key) {
			return (requestData.query[key] as string) || "";
		},
		getRequestBody() {
			return requestData.body;
		},
		getRouteParam(key) {
			return requestData.params[key] || "";
		},
		httpRequestMethod: requestData.method,
		httpRequestRoute: requestData.path,
		setHeader(key, value) {
			if (ctx) {
				ctx.header(key, value);
			}
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
