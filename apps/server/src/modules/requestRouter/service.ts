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
	type BlockTrace,
} from "@fluxify/blocks";
import { Context } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { JsVM } from "@fluxify/lib";
import { runBlocks } from "./executor";
import { getAppConfig } from "../../loaders/appconfigLoader";
import {
	parseRequestSchema,
	ValidationError,
	type CompiledRequestSchema,
} from "../../lib/schemaParser";
import {
	createObservabilityLogger,
	DbConnectionManager,
	DbFactory,
} from "@fluxify/adapters";
import {
	dbIntegrationsCache,
	findIntegrationConfig,
	observabilityIntegrationsCache,
	ownsIntegration,
} from "../../loaders/integrationsLoader";
import * as zodLib from "zod";
import { projectSettingsCache } from "../../loaders/projectSettingsLoader";
import type { RequestEnvelope } from "./types";
import { RequestBodyError } from "./requestBody";
import {
	readRouteBody,
	runWithRouteObserver,
	type RouteExecutionObserver,
} from "./dispatchSupport";
import {
	startRouteTrace,
	traceCompleter,
	type RouteTraceFactory,
} from "./traceLifecycle";

dayjs.extend(dayjsUtc);

export type HandleRequestType = {
	data?: any;
	status: ContentfulStatusCode;
};

export type RouteValidatorResolver = (routeId: string) => {
	body?: CompiledRequestSchema;
	query?: CompiledRequestSchema;
	params?: CompiledRequestSchema;
} | undefined;

// defined in ./types so it has no import cycle with the envelope; re-exported
// here because the test-suites runner imports it from this module.
export type { RequestOverrides } from "./types";
export type { RouteExecutionObserver } from "./dispatchSupport";
export type { RouteTrace, RouteTraceFactory } from "./traceLifecycle";
export { envelopeFromHttp } from "./envelope";
import type { RequestOverrides } from "./types";

export const DEFAULT_ROUTE_TIMEOUT_SECONDS = 30;
let dbConnectionManager: DbConnectionManager | undefined;
const httpClient = new HttpClient();

/** The compiled runtime supplies one manager for its isolated process. */
export function setDbConnectionManager(manager?: DbConnectionManager) {
	dbConnectionManager = manager;
}

/** Default origin for in-process callers (test-suite runner) that predate the envelope. */
const DEFAULT_TRIGGER: TriggerContext = {
	kind: "route",
	source: "http",
	reply: "sync",
};

/**
 * Transport-agnostic entry point of the worker. Matches the route from the
 * envelope's payload and runs it. `httpCtx` is only for HTTP side-effects
 * (response cookies/headers); non-HTTP sources omit it and those calls no-op.
 */
export async function dispatch(
	env: RequestEnvelope,
	parser: HttpRouteParser,
	httpCtx?: Context,
	observer?: RouteExecutionObserver,
	resolveValidators?: RouteValidatorResolver,
	traceFactory?: RouteTraceFactory,
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

	// Keep recorder creation after matching so untraced routes preserve the old
	// zero-work path.
	const trace = startRouteTrace(path, payload, traceFactory);
	const completeTrace = traceCompleter(trace);
	try {
		const body = await readRouteBody(payload, path.acceptedContentTypes);
		const response = await runWithRouteObserver(observer, path, DEFAULT_ROUTE_TIMEOUT_SECONDS, () =>
			executeRouteInternal(
				{
				id: path.id,
				projectId: path.projectId!,
				projectName: path.projectName!,
				routeParams: path.routeParams,
				bodySchema: path.bodySchema,
				querySchema: path.querySchema,
				paramsSchema: path.paramsSchema,
				timeoutSeconds: path.timeoutSeconds,
				validators: resolveValidators?.(path.id),
				trace,
			},
			{
				method: payload.method,
				path: payload.path,
				headers: payload.headers,
				query: payload.query,
				body,
				params: path.routeParams || payload.params || {},
			},
			httpCtx,
					overrides,
					trigger,
				),
			);
		completeTrace(response.status >= 400 ? "failure" : "success", response.status);
		return response;
	} catch (error) {
		if (error instanceof RequestBodyError) {
			const response = { status: error.status, data: { message: error.message } };
			completeTrace("failure", response.status);
			return response;
		}
		completeTrace("failure", 500);
		throw error;
	}
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
		timeoutSeconds?: number;
		trace?: BlockTrace;
		validators?: {
			body?: CompiledRequestSchema;
			query?: CompiledRequestSchema;
			params?: CompiledRequestSchema;
		};
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
	const denied = assertOverridesOwned(routeInfo.projectId, overrides);
	if (denied) return denied;

	const vars = setupContextVars(
		ctx,
		requestData,
		routeInfo.id,
		httpClient,
		routeInfo.projectId,
		overrides,
		trigger,
	);

	if (routeInfo.bodySchema && Object.keys(routeInfo.bodySchema).length > 0) {
		const result = await validateSchema(
			routeInfo.validators?.body,
			routeInfo.bodySchema,
			requestData.body,
			{
				vars,
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
		const result = await validateSchema(
			routeInfo.validators?.query,
			routeInfo.querySchema,
			requestData.query,
			{
				vars,
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
		const result = await validateSchema(
			routeInfo.validators?.params,
			routeInfo.paramsSchema,
			requestData.params,
			{ vars, coerce: true },
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

	const vm = createJsVM(vars);
	const dbFactory = createDbFactory(
		vm,
		routeInfo.projectId,
		overrides?.integrations,
	);
	const context = createContext(
		routeInfo,
		requestData,
		vm,
		vars,
		dbFactory,
		httpClient,
		trigger,
		routeInfo.timeoutSeconds ?? DEFAULT_ROUTE_TIMEOUT_SECONDS,
		routeInfo.trace,
	);

	try {
		const executionResult = await runBlocks(
			{
				projectId: routeInfo.projectId,
				routeId: routeInfo.id,
				projectName: routeInfo.projectName,
			},
			context,
		);

		if (executionResult) return parseResult(executionResult);
		return {
			status: 500,
			data: { message: "Internal server error" },
		};
	} finally {
		dbFactory.dispose();
	}
}

/**
 * A context for work that arrived off the queue rather than off a request.
 *
 * Same integrations, app config and logger a route gets — the difference is
 * that there is no HTTP exchange, so cookies and headers are no-ops and the
 * request accessors return empty. Nothing from the enqueuing request survives
 * except the payload it queued.
 *
 * ponytail: fixed timeout. Give it a per-job setting when a job legitimately
 * needs to outlive it.
 */
export const DEFAULT_JOB_TIMEOUT_SECONDS = 300;

export function createJobContext(job: {
	id: string;
	projectId: string;
	target: string;
	timeoutSeconds?: number;
	/**
	 * Overrides the default trigger. A queued custom block and a workflow run
	 * differ only in where they came from, so they share this function rather
	 * than each getting a near-copy of it.
	 */
	trigger?: Partial<TriggerContext>;
	/** What the job carried. It is the body a graph reads, there being no request. */
	payload?: unknown;
}): BlockContext {
	const trigger: TriggerContext = {
		kind: "job",
		source: "nats",
		reply: "async",
		id: job.id,
		...job.trigger,
	};
	const requestData = {
		method: "",
		path: job.target,
		headers: {},
		query: {},
		body: job.payload,
		params: {},
	};
	const vars = setupContextVars(
		undefined,
		requestData,
		job.target,
		httpClient,
		job.projectId,
		undefined,
		trigger,
	);
	const vm = createJsVM(vars);
	return createContext(
		{ id: job.target, projectId: job.projectId },
		requestData,
		vm,
		vars,
		new DbFactory(vm, dbIntegrationsCache, dbConnectionManager),
		httpClient,
		trigger,
		job.timeoutSeconds ?? DEFAULT_JOB_TIMEOUT_SECONDS,
	);
}

function validateSchema(
	compiled: CompiledRequestSchema | undefined,
	schema: unknown,
	value: unknown,
	context: Parameters<CompiledRequestSchema["validate"]>[1],
) {
	return compiled
		? compiled.validate(value, context)
		: parseRequestSchema(schema, value, context);
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

/**
 * The logger for one integration id, or the server console when the id is empty,
 * unknown, or owned by another project. Shared by the JS `logger` api and the
 * cloud logs block so both resolve a destination the same way.
 *
 * The config is spread, never mutated: the cache entry is shared by every
 * in-flight request, so writing route ids into it cross-labels concurrent logs.
 * A provider is still built per call — that lifecycle is #204, not this.
 */
function observabilityLoggerFor(
	connectionId: string,
	projectId: string,
	routeId: string,
): AbstractLogger {
	const config = observabilityIntegrationsCache[connectionId];
	if (!ownsIntegration(config, projectId)) {
		return new ConsoleLoggerProvider(routeId);
	}
	return createObservabilityLogger(config["variant"], {
		...config,
		projectId,
		routeId,
	})!;
}

function createContext(
	routeInfo: { id: string; projectId: string },
	requestData: { path: string; body: any },
	vm: JsVM,
	vars: ContextVarsType & Record<string, any>,
	dbFactory: DbFactory,
	httpClient: HttpClient,
	trigger: TriggerContext,
	timeoutSeconds: number,
	trace?: BlockTrace,
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
		trace,
		// The cloud logs block picks its own integration per block, so it resolves
		// through here rather than through the project's logs destination. Only the
		// legacy interpreted path used to supply this, which left the block throwing
		// on a missing factory for every compiled route.
		integrationFactory: {
			create({ integrationId, type }) {
				if (type !== "observability") return undefined;
				return observabilityLoggerFor(
					integrationId,
					routeInfo.projectId,
					routeInfo.id,
				);
			},
		},
		stopper: {
			timeoutEnd: 0,
			duration: timeoutSeconds * 1000,
		},
	};
}

/**
 * Every integration id an override names must belong to the project the route
 * belongs to. Rejected outright rather than ignored: a request aimed at another
 * tenant's integration should fail loudly, not silently run against the real one.
 */
export function assertOverridesOwned(
	projectId: string,
	overrides?: RequestOverrides,
): HandleRequestType | null {
	const foreign = (overrides?.integrations ?? [])
		.map((o) => o.newId)
		.filter((id) => {
			// every group, not just db and observability: a kv or ai override
			// naming another tenant's integration used to pass unchecked
			const config = findIntegrationConfig(id);
			return config && !ownsIntegration(config, projectId);
		});

	if (foreign.length === 0) return null;
	return {
		status: 403,
		data: {
			message: "Integration override not permitted",
			integrations: foreign,
		},
	};
}

/**
 * Overrides are the integration-mocking seam: a request may point a block at a
 * different integration id. They are request input, so the target must be
 * checked against the project — otherwise any request can name another tenant's
 * integration id and read their database.
 */
function createDbFactory(
	vm: JsVM,
	projectId: string,
	integrationOverrides?: Array<{ existingId: string; newId: string }>,
) {
	if (!integrationOverrides || integrationOverrides.length === 0) {
		return new DbFactory(vm, dbIntegrationsCache, dbConnectionManager);
	}

	const customDbCache = { ...dbIntegrationsCache };
	for (const override of integrationOverrides) {
		const target = dbIntegrationsCache[override.newId];
		// ownership is already gated by assertOverridesOwned(); this is the
		// second half of the same check, so a missed gate cannot leak
		if (!target || !ownsIntegration(target, projectId)) continue;
		customDbCache[override.existingId] = target;
	}
	return new DbFactory(vm, customDbCache, dbConnectionManager);
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
	const headers = new Map(
		Object.entries(requestData.headers).map(([key, value]) => [
			key.toLowerCase(),
			value,
		]),
	);
	const projectSettings = projectSettingsCache[projectId];
	// new key first, legacy second — the same order the telemetry worker reads
	// them in. Projects configured through the current UI only have the new one.
	let connectionId =
		projectSettings?.["settings.telemetry.logsConnectionId"] ||
		projectSettings?.["settings.ai.loggerConnectionId"] ||
		"";

	// Apply integration override for logger if present
	if (connectionId && overrides?.integrations) {
		const override = overrides.integrations.find(
			(o) => o.existingId === connectionId,
		);
		if (
			override &&
			ownsIntegration(observabilityIntegrationsCache[override.newId], projectId)
		) {
			connectionId = override.newId;
		}
	}

	const logger = observabilityLoggerFor(connectionId, projectId, routeId);

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
			dayjs,
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
			return headers.get(key.toLowerCase()) || "";
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

