import {
	compileGraph,
	type BlockTraceSpan,
	type RouteMiddlewares,
	runWithMiddlewares,
} from "@fluxify/blocks";
import {
	hydrateIntegrations,
	OWNER_KEY,
} from "@fluxify/server/src/loaders/integrationsLoader";
// `appconfigLoader`, not `appConfigLoader` — the file is lowercase and CI runs
// on a case-sensitive filesystem, so the camelCase spelling only resolves locally
import { hydrateAppConfig } from "@fluxify/server/src/loaders/appconfigLoader";
import { setBlocksExecutor } from "@fluxify/server/src/modules/requestRouter/executor";
import { executeRouteInternal } from "@fluxify/server/src/modules/requestRouter/service";
import {
	startRouteTrace,
	type TraceSinks,
	wantsSpans,
} from "@fluxify/server/src/modules/requestRouter/traceLifecycle";
import { RouteTraceRecorder } from "@fluxify/server/src/modules/telemetry/routeRecorder";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { Hono } from "hono";
import { connectionFor } from "./engines";
import { registerFixtureBlocks } from "./customBlocks";
import type { GraphFixture } from "./graph";

/**
 * Runs a graph fixture the way a compiled worker does.
 *
 * The graph goes through the real compiler and the result is installed on the
 * same `setBlocksExecutor` seam `compiledRuntime` uses, so the request travels
 * the production path: context vars, request schema validation, block
 * execution against a real database, response shaping. Only the artifact
 * transport (NATS KV, the supervisor, the child process) is bypassed.
 *
 * Deep imports into apps/server on purpose — `executor.ts` and `service.ts` are
 * the execution-process modules and open no connections. The package barrel
 * would drag in the database and NATS.
 */

export const PROJECT_ID = "e2e-project";
/** the integration id every fixture points its db blocks at */
export const DB_CONNECTION = "primary";
/**
 * The project's app config, as the worker would receive it over KV — a fixture
 * reaches it through `getConfig`, and a custom block through an
 * `app_config_selector` param naming the key.
 */
export const APP_CONFIG: Record<string, string | number | boolean> = {
	JWT_SIGNING_SECRET: "e2e-custom-block-secret",
};

export type GraphRequest = {
	method?: string;
	path?: string;
	headers?: Record<string, string>;
	query?: Record<string, string | string[]>;
	params?: Record<string, string>;
	body?: unknown;
};

export type GraphRun = {
	/** what the client would receive */
	status: number;
	body: any;
	/** one entry per block that actually executed, in completion order */
	spans: BlockTraceSpan[];
	/** the block ids that ran — the cheapest assertion against a dead branch */
	executed: string[];
	/** the generated JavaScript, for asserting on compilation itself */
	source: string;
	/** response headers, including what Set Header and Set Cookie wrote */
	headers: Headers;
	/**
	 * Runs the real recorder handed over, when the fixture ran with `sinks` —
	 * what the execution process would export or publish (#254).
	 */
	recorded: TraceRunPayload[];
};

/** Points the project's `primary` db integration at the fixture's engine. */
async function hydrateDatabase(fixture: GraphFixture) {
	const engine = fixture.engine ?? "pg";
	// a graph that touches no database should not start a container for it
	if (engine === "none") return;
	const connection = await connectionFor(engine);
	hydrateIntegrations(PROJECT_ID, {
		db: {
			[DB_CONNECTION]: {
				...connection,
				queryTimeoutMs: fixture.queryTimeoutMs,
				maxConnections: fixture.maxConnections,
				[OWNER_KEY]: PROJECT_ID,
			},
		},
	});
}

export async function runGraph(
	fixture: GraphFixture,
	request: GraphRequest = {},
	/** the route's tracing and recording switches; left out, every span is collected flat */
	sinks?: TraceSinks,
): Promise<GraphRun> {
	hydrateAppConfig(PROJECT_ID, APP_CONFIG);
	await hydrateDatabase(fixture);
	const { middlewares, dispose } = await registerFixtureBlocks(fixture);

	try {
		return await execute(fixture, request, middlewares, sinks);
	} finally {
		dispose();
	}
}

async function execute(
	fixture: GraphFixture,
	request: GraphRequest,
	middlewares: RouteMiddlewares | undefined,
	sinks: TraceSinks | undefined,
): Promise<GraphRun> {
	// the same gate the compiler and the execution process apply
	const { run, source } = compileGraph(
		fixture.blocks,
		fixture.edges,
		sinks ? { tracing: wantsSpans(sinks) } : {},
	);
	const spans: BlockTraceSpan[] = [];
	const recorded: TraceRunPayload[] = [];

	setBlocksExecutor(async (_target, context) => {
		// a real recorder came in with the route; otherwise collect spans flat
		context.trace ??= {
			recordSpan: (span) => spans.push(span),
			// a nested custom block records into the same list; the span's blockId
			// still identifies it, and flat order is what assertions read
			enterCustomBlock: () => ({ trace: context.trace!, close: () => {} }),
		};
		return runWithMiddlewares(context, context.requestBody, run, middlewares);
	});

	const route = {
			id: `${fixture.name}-route`,
			projectId: PROJECT_ID,
			projectName: "E2E",
			bodySchema: fixture.schemas?.body,
			querySchema: fixture.schemas?.query,
		paramsSchema: fixture.schemas?.params,
	};
	const method = request.method ?? fixture.route.method;
	const path = request.path ?? fixture.route.path;
	const headers = request.headers ?? {};
	// what `dispatch` does: no recorder unless tracing or recording asks for one
	const trace = sinks
		? startRouteTrace(
				{ ...route, ...sinks },
				{ method, path },
				{ start: (target) => new RouteTraceRecorder(target, (run) => recorded.push(run)) },
			)
		: undefined;
	// a real request context, so header and cookie blocks read and write a real request/response
	let result!: Awaited<ReturnType<typeof executeRouteInternal>>;
	const app = new Hono().all("*", async (c) => {
		result = await executeRouteInternal(
			{ ...route, trace },
			{
				method,
				path,
				headers,
				query: request.query ?? {},
				params: request.params ?? {},
				body: request.body ?? null,
			},
			c,
		);
		return c.body(null);
	});
	const response = await app.request(`http://e2e${path}`, { method, headers });
	trace?.complete(Number(result.status) >= 400 ? "failure" : "success", Number(result.status));

	return {
		// the response block carries httpCode as a string; the HTTP layer coerces
		// it, so assert against what a client actually sees
		status: Number(result.status),
		body: result.data,
		spans,
		executed: spans.map((span) => span.blockId),
		source,
		headers: response.headers,
		recorded,
	};
}
