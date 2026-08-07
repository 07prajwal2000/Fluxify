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
	UnsealedProjectConfig,
} from "../compiler/artifacts";
import { artifactId, artifactKind } from "../compiler/subjects";
import { setBlocksExecutor } from "./executor";
import { setDbConnectionManager } from "./service";

/**
 * Execution-side half of the compile pipeline: turns artifacts into a live
 * route table, custom block library and hydrated config.
 *
 * Deliberately imports nothing that opens a connection — no NATS, no Redis, no
 * database. This module runs inside the isolated execution process, and anything it
 * initialises becomes reachable from user JS running in that same thread. The
 * supervisor owns the connections and feeds artifacts in.
 */

/** what the supervisor hands over, on spawn and on every later update */
export type ArtifactEntry = { key: string; value: any | null };

type CompiledRoute = {
	artifact: RouteArtifact;
	run: (ctx: Context, input?: any) => Promise<BlockOutput | null>;
	validators: RouteValidators;
};

export type RouteValidators = {
	body?: CompiledRequestSchema;
	query?: CompiledRequestSchema;
	params?: CompiledRequestSchema;
};

const routes = new Map<string, CompiledRoute>();
/** custom block artifact id -> registered name, so a delete can unregister it */
const customBlockNamesById = new Map<string, string>();
let dbConnectionManager: DbConnectionManager | undefined;
/** one instance for the process — the router captured it, so update in place */
const parser = new HttpRouteParser();

export function compiledRouteParser() {
	return parser;
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
	// custom blocks first: a route that invokes one needs it in the library
	for (const { key, value } of entries) {
		if (artifactKind(key) !== "route") applyArtifact(key, value);
	}
	for (const { key, value } of entries) {
		if (artifactKind(key) === "route") applyArtifact(key, value);
	}

	setBlocksExecutor(async (target, context) => {
		const compiled = routes.get(target.routeId);
		if (!compiled) {
			throw new Error(`No compiled graph for route ${target.routeId}`);
		}
		return compiled.run(context, context.requestBody);
	});

	logger.info(
		`[worker] compiled runtime ready — ${routes.size} routes, ${customBlockNamesById.size} custom blocks`,
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
		case "project-config":
			return value && applyProjectConfig(value as UnsealedProjectConfig);
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
	hydrateProjectSettings(artifact.projectId, payload.projectSettings);
	logger.info(
		`[worker] project config applied (${artifact.compiledAt})`,
		"WORKER.compiled",
	);
}
