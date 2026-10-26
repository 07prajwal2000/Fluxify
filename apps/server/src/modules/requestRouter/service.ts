import {
	type DbConnectionManager,
	DbFactory,
	KvFactory,
	QueueProducerFactory,
} from "@fluxify/adapters";
import type {
	Context as BlockContext,
	BlockOutput,
	BlockTrace,
	ContextVarsType,
	TriggerContext,
} from "@fluxify/blocks";
import { type CompiledRequestSchema, parseRequestSchema } from "@fluxify/blocks/schema";
import { HttpClient, type HttpRoute, type HttpRouteParser } from "@fluxify/lib";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { BodyMode } from "../../lib/routeConfig";
import {
	dbIntegrationsCache,
	findIntegrationConfig,
	kvIntegrationsCache,
	ownsIntegration,
	queueIntegrationsCache,
} from "../../loaders/integrationsLoader";
import { DEFAULT_TRIGGER, setupContextVars } from "./contextVars";
import {
	type RouteExecutionObserver,
	readRouteBody,
	runWithRouteObserver,
} from "./dispatchSupport";
import { runBlocks } from "./executor";
import { observabilityLoggerFor } from "./observabilityLogger";
import { isFormBody, RequestBodyError } from "./requestBody";
import { requestTraceInput } from "./traceInput";
import { type RouteTraceFactory, startRouteTrace, traceCompleter } from "./traceLifecycle";
import type { RequestEnvelope } from "./types";

export type HandleRequestType = {
	data?: any;
	status: ContentfulStatusCode;
	/** why the run failed; never sent to the caller, only to an admin's debug call (#671) */
	error?: unknown;
};

export type RouteValidatorResolver = (routeId: string) =>
	| {
			body?: CompiledRequestSchema;
			query?: CompiledRequestSchema;
			params?: CompiledRequestSchema;
	  }
	| undefined;

export type { RouteExecutionObserver } from "./dispatchSupport";
export { envelopeFromHttp } from "./envelope";
export type { RouteTrace, RouteTraceFactory } from "./traceLifecycle";
// defined in ./types so it has no import cycle with the envelope; re-exported
// here because the test-suites runner imports it from this module.
export type { RequestOverrides } from "./types";

import type { RequestOverrides } from "./types";

export const DEFAULT_ROUTE_TIMEOUT_SECONDS = 30;
let dbConnectionManager: DbConnectionManager | undefined;
const httpClient = new HttpClient();

/** The compiled runtime supplies one manager for its isolated process. */
export function setDbConnectionManager(manager?: DbConnectionManager) {
	dbConnectionManager = manager;
}

/**
 * Transport-agnostic entry point of the worker. Matches the route from the
 * envelope's payload and runs it. `httpCtx` is only for HTTP side-effects
 * (response cookies/headers); non-HTTP sources omit it and those calls no-op.
 */
export async function dispatch(
	env: RequestEnvelope,
	parser: Pick<HttpRouteParser, "getRouteId">,
	httpCtx?: Context,
	observer?: RouteExecutionObserver,
	resolveValidators?: RouteValidatorResolver,
	traceFactory?: RouteTraceFactory,
): Promise<HandleRequestType> {
	const { payload, trigger, overrides } = env;
	const path = parser.getRouteId(payload.path, payload.method as HttpRoute["method"]);
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
		const body = await readRouteBody(payload, path.acceptedContentTypes, path.bodyMode);
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
					bodyMode: path.bodyMode,
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
		// the headers are copied for the trace only; untraced routes skip it
		completeTrace(
			response.status >= 400 ? "failure" : "success",
			response.status,
			trace && { headers: answeredHeaders(httpCtx) },
		);
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

/** the headers a run set on its response; repeated ones (Set-Cookie) join on a new line */
function answeredHeaders(httpCtx?: Context) {
	// the execution process's own context keeps them apart from Hono's `res`
	const headers: Headers | undefined =
		(httpCtx as { responseHeaders?: Headers } | undefined)?.responseHeaders ??
		httpCtx?.res?.headers;
	const out: Record<string, string> = {};
	for (const [name, value] of headers ?? [])
		out[name] = name in out ? `${out[name]}\n${value}` : value;
	return out;
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
		/** a stream body has no shape to validate; the schema is ignored */
		bodyMode?: BodyMode;
		trace?: BlockTrace;
		validators?: {
			body?: CompiledRequestSchema;
			formBody?: CompiledRequestSchema;
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

	// the client going away cancels the run (#1000)
	const signal = ctx?.req.raw?.signal;
	// no signal, nothing to bind: keep the shared client
	const http = signal ? new HttpClient(signal) : httpClient;
	const vars = setupContextVars(
		ctx,
		requestData,
		routeInfo.id,
		http,
		routeInfo.projectId,
		overrides,
		trigger,
		signal,
	);

	if (
		routeInfo.bodyMode !== "stream" &&
		routeInfo.bodySchema &&
		Object.keys(routeInfo.bodySchema).length > 0
	) {
		const coerce = isFormBody(requestData.headers);
		const result = await validateSchema(
			coerce ? routeInfo.validators?.formBody : routeInfo.validators?.body,
			routeInfo.bodySchema,
			requestData.body,
			{ vars, coerce },
		);
		if (!result.success) {
			return {
				status: 400,
				data: { message: "Body validation failed", errors: result.errors },
			};
		}
		// defaults and coerced values are what the workflow should see
		requestData.body = result.data as typeof requestData.body;
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
		// defaults and coerced values are what the workflow should see
		requestData.query = result.data as typeof requestData.query;
	}

	if (routeInfo.paramsSchema && Object.keys(routeInfo.paramsSchema).length > 0) {
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
		requestData.params = result.data as typeof requestData.params;
	}

	const dbFactory = createDbFactory(routeInfo.projectId, overrides?.integrations, signal);
	const context = createContext(
		routeInfo,
		requestData,
		vars,
		dbFactory,
		http,
		trigger,
		routeInfo.timeoutSeconds ?? DEFAULT_ROUTE_TIMEOUT_SECONDS,
		routeInfo.trace,
		signal,
	);
	// only when spans are compiled in; untraced routes pay nothing (#628)
	if (routeInfo.trace) {
		context.traceInput = requestTraceInput(
			// a stream is consumed by the graph; recording it would tell a viewer
			// nothing and must not pull it back into memory
			routeInfo.bodyMode === "stream" ? { ...requestData, body: "[stream]" } : requestData,
			ctx?.req.raw?.url,
		);
	}

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
	trace?: BlockTrace;
	/** cancels the job's run (#1000) */
	signal?: AbortSignal;
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
	const http = job.signal ? new HttpClient(job.signal) : httpClient;
	const vars = setupContextVars(
		undefined,
		requestData,
		job.target,
		http,
		job.projectId,
		undefined,
		trigger,
		job.signal,
	);
	return createContext(
		{ id: job.target, projectId: job.projectId },
		requestData,
		vars,
		new DbFactory(dbIntegrationsCache, dbConnectionManager, job.signal),
		http,
		trigger,
		job.timeoutSeconds ?? DEFAULT_JOB_TIMEOUT_SECONDS,
		job.trace,
		job.signal,
	);
}

function validateSchema(
	compiled: CompiledRequestSchema | undefined,
	schema: unknown,
	value: unknown,
	context: Parameters<CompiledRequestSchema["validate"]>[1],
) {
	return compiled ? compiled.validate(value, context) : parseRequestSchema(schema, value, context);
}

function parseResult(executionResult: BlockOutput) {
	return {
		error: executionResult.successful ? undefined : executionResult.error,
		status: executionResult.output?.httpCode || (executionResult.error ? 500 : 200),
		data:
			// ?? not ||: a body of 0, false or "" is still the body
			executionResult.output?.body ?? // has output from previous blocks which passed to response block
			(executionResult?.output || // has output from previous blocks which didn't pass (or no response block) to response block
				(!executionResult.successful
					? { error: executionResult.error?.toString() || "Unknown error" }
					: "NO RESULT")),
	};
}

function createContext(
	routeInfo: { id: string; projectId: string },
	requestData: { path: string; body: any },
	vars: ContextVarsType & Record<string, any>,
	dbFactory: DbFactory,
	httpClient: HttpClient,
	trigger: TriggerContext,
	timeoutSeconds: number,
	trace?: BlockTrace,
	signal?: AbortSignal,
): BlockContext {
	return {
		apiId: routeInfo.id,
		route: requestData.path,
		projectId: routeInfo.projectId,
		requestBody: requestData.body,
		vars,
		dbFactory,
		// Built here rather than threaded through every caller: unlike DbFactory
		// there is no per-request state to own — the clients are process-wide and
		// there are no leases to release — so an instance is just the cache lookup.
		kvFactory: new KvFactory(kvIntegrationsCache, signal),
		// producers are process-wide like the KV clients; the instance only scopes
		// lookups to this project's integrations
		queueFactory: new QueueProducerFactory(
			queueIntegrationsCache,
			kvIntegrationsCache,
			(config) => ownsIntegration(config, routeInfo.projectId),
			undefined,
			signal,
		),
		httpClient,
		trigger,
		trace,
		signal,
		// The cloud logs block picks its own integration per block, so it resolves
		// through here rather than through the project's logs destination. Only the
		// legacy interpreted path used to supply this, which left the block throwing
		// on a missing factory for every compiled route.
		integrationFactory: {
			create({ integrationId, type }) {
				if (type !== "observability") return undefined;
				return observabilityLoggerFor(integrationId, routeInfo.projectId, routeInfo.id);
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
	projectId: string,
	integrationOverrides?: Array<{ existingId: string; newId: string }>,
	signal?: AbortSignal,
) {
	if (!integrationOverrides || integrationOverrides.length === 0) {
		return new DbFactory(dbIntegrationsCache, dbConnectionManager, signal);
	}

	const customDbCache = { ...dbIntegrationsCache };
	for (const override of integrationOverrides) {
		const target = dbIntegrationsCache[override.newId];
		// ownership is already gated by assertOverridesOwned(); this is the
		// second half of the same check, so a missed gate cannot leak
		if (!target || !ownsIntegration(target, projectId)) continue;
		customDbCache[override.existingId] = target;
	}
	return new DbFactory(customDbCache, dbConnectionManager, signal);
}
