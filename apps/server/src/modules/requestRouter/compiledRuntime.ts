import { DbConnectionManager } from "@fluxify/adapters";
import {
	instantiateCompiled,
	registerCompiledCustomBlock,
	type BlockOutput,
	type Context,
	unregisterCustomBlock,
} from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import { HttpRouteParser, type HttpRoute } from "@fluxify/lib";
import {
	compileRequestSchema,
	type CompiledRequestSchema,
} from "../../lib/schemaParser";
import { hydrateAppConfig } from "../../loaders/appconfigLoader";
import {
	dbIntegrationsCache,
	hydrateIntegrations,
} from "../../loaders/integrationsLoader";
import { hydrateProjectSettings } from "../../loaders/projectSettingsLoader";
import type {
	CustomBlockArtifact,
	RouteArtifact,
	TriggerArtifact,
	UnsealedProjectConfig,
	WorkflowArtifact,
} from "../compiler/artifacts";
import { artifactId, artifactKind } from "../compiler/subjects";
import {
	applyQueueTrigger,
	refreshQueueTriggers,
	shutdownQueueTriggers,
} from "../triggers/queueRuntime";
import { setBlocksExecutor } from "./executor";
import { setDbConnectionManager } from "./service";

/**
 * Execution-side half of the compile pipeline: turns artifacts into a live
 * route table, custom block library and hydrated config.
 *
 * Deliberately imports nothing that opens a connection to Fluxify's own
 * infrastructure — no NATS, no Redis, no platform database. This module runs
 * inside the isolated execution process, and anything it initialises becomes
 * reachable from user JS running in that same thread. The supervisor owns those
 * connections and feeds artifacts in. The user's own integrations (databases,
 * external queues) are the exception: their credentials already reach user code.
 */

/** what the supervisor hands over, on spawn and on every later update */
export type ArtifactEntry = { key: string; value: any | null };

type CompiledRoute = {
	artifact: RouteArtifact;
	run: (ctx: Context, input?: any) => Promise<BlockOutput | null>;
	validators: RouteValidators;
};

type CompiledWorkflow = {
	artifact: WorkflowArtifact;
	run: (ctx: Context, input?: any) => Promise<BlockOutput | null>;
};

export type RouteValidators = {
	body?: CompiledRequestSchema;
	query?: CompiledRequestSchema;
	params?: CompiledRequestSchema;
};

const routes = new Map<string, CompiledRoute>();
/**
 * Workflows, kept apart from `routes` on purpose. They are the same compiled
 * graph, but a route is reachable through the HTTP parser and a workflow must
 * not be — a background job is not an endpoint somebody can curl.
 */
const workflows = new Map<string, CompiledWorkflow>();
/** custom block artifact id -> registered name, so a delete can unregister it */
const customBlockNamesById = new Map<string, string>();
let dbConnectionManager: DbConnectionManager | undefined;
/** one instance for the process — the router captured it, so update in place */
const parser = new HttpRouteParser();

export function compiledRouteParser() {
	return parser;
}

/** The compiled workflow a job handler runs, or undefined if this worker has none. */
export function compiledWorkflow(workflowId: string): CompiledWorkflow | undefined {
	return workflows.get(workflowId);
}

/** Cached alongside the compiled graph; no Zod tree is rebuilt per request. */
export function compiledRouteValidators(routeId: string): RouteValidators | undefined {
	return routes.get(routeId)?.validators;
}

/**
 * Builds the runtime from the artifact set handed over at spawn. Returns the
 * route parser dispatch() matches against.
 */
export function initCompiledRuntime(
	entries: ArtifactEntry[],
	databaseIdleTimeoutMs?: number,
): HttpRouteParser {
	dbConnectionManager = new DbConnectionManager(undefined, {
		idleTimeoutMs: databaseIdleTimeoutMs,
	});
	setDbConnectionManager(dbConnectionManager);
	// custom blocks and config first: a graph that invokes one needs it in the
	// library before it is instantiated. Triggers last: a consumer must not
	// start pulling before the workflow it feeds exists.
	const phase = (key: string) => {
		const kind = artifactKind(key);
		if (kind === "trigger") return 2;
		return kind === "route" || kind === "workflow" ? 1 : 0;
	};
	for (const current of [0, 1, 2]) {
		for (const { key, value } of entries) {
			if (phase(key) === current) applyArtifact(key, value);
		}
	}

	setBlocksExecutor(async (target, context) => {
		const compiled = routes.get(target.routeId);
		if (!compiled) {
			throw new Error(`No compiled graph for route ${target.routeId}`);
		}
		return compiled.run(context, context.requestBody);
	});

	logger.info(
		`[worker] compiled runtime ready — ${routes.size} routes, ${workflows.size} workflows, ${customBlockNamesById.size} custom blocks`,
		"WORKER.compiled",
	);
	return parser;
}

/** a later update pushed down by the supervisor */
export function applyArtifactUpdate(key: string, value: any | null) {
	applyArtifact(key, value);
}

/** Releases all long-lived database clients before the execution process exits. */
export async function shutdownCompiledRuntime() {
	// consumers first: their in-flight batches still hold database leases
	await shutdownQueueTriggers();
	await dbConnectionManager?.close();
	dbConnectionManager = undefined;
	setDbConnectionManager();
}

function applyArtifact(key: string, value: any | null) {
	switch (artifactKind(key)) {
		case "route":
			return value
				? addRoute(value as RouteArtifact)
				: removeRoute(artifactId(key));
		case "custom-block":
			return value
				? addCustomBlock(value as CustomBlockArtifact)
				: removeCustomBlock(artifactId(key));
		case "workflow":
			return value
				? addWorkflow(value as WorkflowArtifact)
				: void workflows.delete(artifactId(key));
		case "project-config":
			return value && applyProjectConfig(value as UnsealedProjectConfig);
		case "trigger":
			return void applyQueueTrigger(
				artifactId(key),
				value as TriggerArtifact | null,
			).catch((error) =>
				logger.error(
					`[worker] failed to apply trigger ${key}: ${String(error)}`,
					"WORKER.compiled",
				),
			);
	}
}

function addRoute(artifact: RouteArtifact) {
	try {
		routes.set(artifact.routeId, {
			artifact,
			run: instantiateCompiled(artifact.source),
			validators: compileRouteValidators(artifact),
		});
		parser.upsertRoute(routeDefinition(artifact));
		logger.info(
			`[worker] loaded ${artifact.method} ${artifact.path}`,
			"WORKER.compiled",
		);
	} catch (error) {
		// a graph that will not instantiate must not take the other routes down
		logger.error(
			`[worker] failed to load route ${artifact.routeId}: ${String(error)}`,
			"WORKER.compiled",
		);
	}
}

function addWorkflow(artifact: WorkflowArtifact) {
	try {
		workflows.set(artifact.workflowId, {
			artifact,
			run: instantiateCompiled(artifact.source),
		});
		logger.info(`[worker] loaded workflow ${artifact.name}`, "WORKER.compiled");
	} catch (error) {
		// one bad graph must not take the rest of the worker down
		logger.error(
			`[worker] failed to load workflow ${artifact.workflowId}: ${String(error)}`,
			"WORKER.compiled",
		);
	}
}

function compileRouteValidators(artifact: RouteArtifact): RouteValidators {
	return {
		body: schemaValidator(artifact.bodySchema),
		query: schemaValidator(artifact.querySchema, true),
		params: schemaValidator(artifact.paramsSchema, true),
	};
}

function schemaValidator(schema: unknown, coerce = false) {
	return schema && typeof schema === "object" && Object.keys(schema).length > 0
		? compileRequestSchema(schema, { coerce })
		: undefined;
}

function removeRoute(routeId: string) {
	if (routes.delete(routeId)) {
		parser.removeRoute(routeId);
		logger.info(`[worker] removed route ${routeId}`, "WORKER.compiled");
	}
}

function routeDefinition(artifact: RouteArtifact): HttpRoute {
	return {
		method: artifact.method as HttpRoute["method"],
		path: artifact.path,
		routeId: artifact.routeId,
		projectId: artifact.projectId,
		projectName: artifact.projectName,
		bodySchema: artifact.bodySchema,
		querySchema: artifact.querySchema,
		paramsSchema: artifact.paramsSchema,
		timeoutSeconds: artifact.timeoutSeconds,
		acceptedContentTypes: artifact.acceptedContentTypes,
		tracingEnabled: artifact.tracingEnabled,
		recordExecution: artifact.recordExecution,
		routeVersion: artifact.routeVersion,
	};
}

function addCustomBlock(artifact: CustomBlockArtifact) {
	try {
		registerCompiledCustomBlock(artifact.name, artifact.source);
		customBlockNamesById.set(artifact.id, artifact.name);
		logger.info(
			`[worker] loaded custom block ${artifact.name}`,
			"WORKER.compiled",
		);
	} catch (error) {
		logger.error(
			`[worker] failed to load custom block ${artifact.id}: ${String(error)}`,
			"WORKER.compiled",
		);
	}
}

function removeCustomBlock(id: string) {
	const name = customBlockNamesById.get(id);
	if (!name) return;
	unregisterCustomBlock(name);
	customBlockNamesById.delete(id);
	logger.info(`[worker] removed custom block ${name}`, "WORKER.compiled");
}

/** already unsealed by the supervisor — the encryption key never enters this thread */
function applyProjectConfig(artifact: UnsealedProjectConfig) {
	const { payload } = artifact;
	hydrateAppConfig(artifact.projectId, payload.appConfig);
	hydrateIntegrations(artifact.projectId, {
		db: payload.dbIntegrations,
		kv: payload.kvIntegrations,
		observability: payload.observabilityIntegrations,
		ai: payload.aiIntegrations,
	});
	// The hydrated cache is the runtime's complete view. Swapping here makes
	// changed credentials available to new requests before old clients drain.
	dbConnectionManager?.synchronize(dbIntegrationsCache);
	// same for queue consumers: rotated credentials restart, deleted ones stop
	void refreshQueueTriggers();
	hydrateProjectSettings(artifact.projectId, payload.projectSettings);
	logger.info(
		`[worker] project config applied (${artifact.compiledAt})`,
		"WORKER.compiled",
	);
}
