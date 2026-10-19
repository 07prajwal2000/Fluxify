import { DbConnectionManager, KvFactory, QueueProducerFactory } from "@fluxify/adapters";
import {
	type BlockOutput,
	type Context,
	closeCtxPools,
	customBlockCount,
	instantiateCompiled,
	type Middleware,
	type RouteMiddlewares,
	registerCompiledCustomBlock,
	runWithMiddlewares,
	unregisterById,
} from "@fluxify/blocks";
import { type CompiledRequestSchema, compileRequestSchema } from "@fluxify/blocks/schema";
import { logger } from "@fluxify/common";
import { type HttpRoute, HttpRouteParser } from "@fluxify/lib";
import type { FluxifyEnv } from "../../lib/env";
import { DEFAULT_BASE_DOMAIN, isPortalOrigin, subdomainOf } from "../../lib/hosting";
import { hydrateAppConfig } from "../../loaders/appconfigLoader";
import {
	dbIntegrationsCache,
	hydrateIntegrations,
	kvIntegrationsCache,
	queueIntegrationsCache,
	unguarded,
} from "../../loaders/integrationsLoader";
import { hydrateProjectSettings } from "../../loaders/projectSettingsLoader";
import type {
	CustomBlockArtifact,
	MiddlewareArtifact,
	RouteArtifact,
	RouteMiddlewareIds,
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
import { verifyDevToken } from "./devToken";
import { setBlocksExecutor } from "./executor";
import { loadPluginBlocks, usePluginBlocks } from "./pluginLoader";
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
	/** the same body schema, coercing: form values arrive as strings */
	formBody?: CompiledRequestSchema;
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
/**
 * Sandboxes (#735) as routes, by sandbox id. Never in a trie: they answer at
 * `/_sandbox/<id>/*` with any method. Their workflow half lives in `workflows`.
 */
const sandboxes = new Map<string, CompiledRoute>();
/** each project's development token hash; only a development config carries one */
const devTokenHashes = new Map<string, string | undefined>();
/** middleware id -> its chain (#579); a route artifact names them by id */
const middlewares = new Map<string, Middleware>();
let dbConnectionManager: DbConnectionManager | undefined;
/**
 * Routes of projects with no subdomain, all in one trie on the bare domain —
 * where two projects sharing a method and path shadow each other (#340).
 */
const parser = new HttpRouteParser();
/** every project's own trie, reached through its subdomain */
const projectParsers = new Map<string, HttpRouteParser>();
const subdomainByProject = new Map<string, string>();
const projectBySubdomain = new Map<string, string>();
/** answers every request with the usual 404 — a subdomain no project holds */
const NO_ROUTES = new HttpRouteParser();
/** as configured: empty means a local install, which also decides who the portal is */
let configuredBaseDomain = "";

/**
 * The trie a request's `Host` selects. A subdomain of the base domain reaches
 * only that project's routes; any other host — the bare domain, an IP, some
 * other name pointed here — gets the shared trie.
 */
export function routeParserFor(host: string | undefined): HttpRouteParser {
	const subdomain = subdomainOf(host, configuredBaseDomain || DEFAULT_BASE_DOMAIN);
	if (subdomain === null) return parser;
	const projectId = projectBySubdomain.get(subdomain);
	return (projectId && projectParsers.get(projectId)) || NO_ROUTES;
}

/** Pushed by the supervisor, which is what watches instance settings. */
export function setBaseDomain(domain: string) {
	configuredBaseDomain = domain;
}

let trustedOrigins: string[] = [];

/** From the supervisor's environment at spawn; this process has none of its own. */
export function setTrustedOrigins(origins: string[]) {
	trustedOrigins = origins;
}

/** The playground calls a project's subdomain from the portal, cross-origin. */
export function fromPortal(origin: string | null) {
	return isPortalOrigin(origin, configuredBaseDomain, trustedOrigins);
}

/** The compiled workflow a job handler runs, or undefined if this worker has none. */
export function compiledWorkflow(workflowId: string): CompiledWorkflow | undefined {
	return workflows.get(workflowId);
}

const SANDBOX_PREFIX = "/_sandbox/";

/**
 * `/_sandbox/<id>/*` (#735): undefined for any other path. A sandbox nobody
 * published here is a 404 like any unknown path, and only the development
 * bucket holds them, so a production worker never serves one. A known sandbox
 * needs its project's development token, or it is a 401. A project with a
 * subdomain answers only there: reached through the shared trie it is a 404,
 * token or not (#742). Otherwise a one-route
 * parser matching any method, and the rest of the path, which is what the
 * sandbox's blocks see as the request path.
 */
export function sandboxRequest(
	path: string,
	devToken: string | null,
	host?: string,
):
	| { status: 401 | 404 }
	| { status: 200; path: string; parser: Pick<HttpRouteParser, "getRouteId"> }
	| undefined {
	if (!path.startsWith(SANDBOX_PREFIX)) return;
	const [id = "", ...rest] = path.slice(SANDBOX_PREFIX.length).split("/");
	const compiled = sandboxes.get(id);
	if (!compiled) return { status: 404 };
	const devTokenHash = devTokenHashes.get(compiled.artifact.projectId);
	if (!verifyDevToken({ devTokenHash }, devToken)) return { status: 401 };
	if (onSharedHostOfSubdomainProject(compiled.artifact.projectId, host)) return { status: 404 };
	const match = {
		...routeDefinition(compiled.artifact),
		id,
		sandbox: true as const,
		// an ephemeral run (#741) records nothing, but its trace still goes back to the caller
		...(compiled.artifact.ephemeral ? { debugSpans: true } : {}),
	};
	return { status: 200, path: `/${rest.join("/")}`, parser: { getRouteId: () => match } };
}

const DEV_PREFIX = "/_/dev";

/**
 * `/_/dev/*` (#736): undefined for any other path. Only a development worker
 * serves it; a production one answers 404 whatever the headers say. The token
 * picks the project, so projects sharing the base domain never shadow each
 * other here; a project subdomain must be the token's own project. A project
 * that has a subdomain answers only there: on the shared host it is a 404 even
 * with a valid token (#742). The route then matches as usual, on the path after
 * the prefix.
 */
export function devRequest(
	path: string,
	host: string | undefined,
	devToken: string | null,
	env: FluxifyEnv | undefined,
):
	| { status: 401 | 404 }
	| { status: 200; path: string; parser: Pick<HttpRouteParser, "getRouteId"> }
	| undefined {
	if (path !== DEV_PREFIX && !path.startsWith(`${DEV_PREFIX}/`)) return;
	if (env !== "development") return { status: 404 };
	const projectId = devToken ? projectOfDevToken(devToken) : undefined;
	if (!projectId) return { status: 401 };
	const own = projectParsers.get(projectId) ?? NO_ROUTES;
	const byHost = routeParserFor(host);
	if (byHost !== parser && byHost !== own) return { status: 404 };
	if (onSharedHostOfSubdomainProject(projectId, host)) return { status: 404 };
	return { status: 200, path: path.slice(DEV_PREFIX.length) || "/", parser: own };
}

/** the request reached the shared trie, but this project lives on its own subdomain */
function onSharedHostOfSubdomainProject(projectId: string, host: string | undefined) {
	return routeParserFor(host) === parser && subdomainByProject.has(projectId);
}

// ponytail: one hash per project per request; a hash -> project map if a dev worker holds thousands
function projectOfDevToken(token: string) {
	for (const [projectId, devTokenHash] of devTokenHashes) {
		if (verifyDevToken({ devTokenHash }, token)) return projectId;
	}
}

/** Cached alongside the compiled graph; no Zod tree is rebuilt per request. */
export function compiledRouteValidators(routeId: string): RouteValidators | undefined {
	return routes.get(routeId)?.validators;
}

/**
 * Builds the runtime from the artifact set handed over at spawn. Returns a
 * promise only when artifacts wait on plugin code; it settles once those are
 * loaded (or failed), so the caller reports ready with everything in.
 */
export function initCompiledRuntime(entries: ArtifactEntry[], databaseIdleTimeoutMs?: number) {
	dbConnectionManager = new DbConnectionManager(undefined, {
		idleTimeoutMs: databaseIdleTimeoutMs,
	});
	setDbConnectionManager(dbConnectionManager);
	// custom blocks, middlewares and config first: a graph that invokes one
	// needs it in the library before it is instantiated. Triggers last: a consumer must not
	// start pulling before the workflow it feeds exists.
	const phase = (key: string) => {
		const kind = artifactKind(key);
		if (kind === "trigger") return 2;
		return kind === "route" || kind === "workflow" || kind?.startsWith("sandbox") ? 1 : 0;
	};
	const pending: Promise<void>[] = [];
	const applyPhase = (current: number) => {
		for (const { key, value } of entries) {
			if (phase(key) !== current) continue;
			const loading = applyArtifact(key, value);
			if (loading) pending.push(loading);
		}
	};
	applyPhase(0);
	applyPhase(1);
	setBlocksExecutor(async (target, context) => {
		const compiled = routes.get(target.routeId) ?? sandboxes.get(target.routeId);
		if (!compiled) {
			throw new Error(`No compiled graph for route ${target.routeId}`);
		}
		return runWithMiddlewares(
			context,
			context.requestBody,
			compiled.run,
			resolveMiddlewares(compiled.artifact.middlewares),
		);
	});

	const finish = () => {
		applyPhase(2);
		logger.info(
			`[worker] compiled runtime ready — ${routes.size} routes, ${workflows.size} workflows, ${customBlockCount()} custom blocks`,
			"WORKER.compiled",
		);
	};
	// a trigger waits for the workflow it feeds, plugin imports included
	if (pending.length) return Promise.all(pending).then(finish);
	finish();
}

/** a later update pushed down by the supervisor */
export function applyArtifactUpdate(key: string, value: any | null) {
	return applyArtifact(key, value);
}

/** Releases all long-lived database clients before the execution process exits. */
export async function shutdownCompiledRuntime() {
	// consumers first: their in-flight batches still hold database leases
	await shutdownQueueTriggers();
	await QueueProducerFactory.closeAll();
	await closeCtxPools();
	await dbConnectionManager?.close();
	dbConnectionManager = undefined;
	setDbConnectionManager();
}

let applied = 0;
/** each key's latest update, so a slow plugin import never lands over a newer one */
const latest = new Map<string, number>();

/**
 * Applies at once unless the artifact calls plugin blocks not yet imported;
 * then it applies once they are. A failed import keeps whatever version of
 * the artifact was serving, like a graph that will not instantiate.
 */
function applyArtifact(key: string, value: any | null): Promise<void> | undefined {
	const update = ++applied;
	if (value) latest.set(key, update);
	else latest.delete(key);
	const loading = value?.pluginBlocks?.length
		? loadPluginBlocks(value.projectId, value.pluginBlocks)
		: undefined;
	if (!loading) return void applyLoaded(key, value);
	return loading.then(
		() => {
			if (latest.get(key) === update) applyLoaded(key, value);
		},
		(error) =>
			logger.error(
				`[worker] failed to load ${key}: ${(error as Error).message}`,
				"WORKER.compiled",
			),
	);
}

function applyLoaded(key: string, value: any | null) {
	applyByKind(key, value);
	usePluginBlocks(key, value?.projectId, value?.pluginBlocks);
}

function applyByKind(key: string, value: any | null) {
	switch (artifactKind(key)) {
		case "route":
			return value ? addRoute(value as RouteArtifact) : removeRoute(artifactId(key));
		case "custom-block":
			return value ? addCustomBlock(value as CustomBlockArtifact) : unregisterById(artifactId(key));
		case "middleware":
			return value
				? addMiddleware(value as MiddlewareArtifact)
				: void middlewares.delete(artifactId(key));
		case "workflow":
		case "sandbox-workflow":
			return value
				? addWorkflow(value as WorkflowArtifact)
				: void workflows.delete(artifactId(key));
		case "sandbox":
			return value ? addSandbox(value as RouteArtifact) : void sandboxes.delete(artifactId(key));
		case "project-config":
			if (value) return applyProjectConfig(value as UnsealedProjectConfig);
			devTokenHashes.delete(key.split(".")[1]!);
			return setProjectSubdomain(key.split(".")[1]!, "");
		case "trigger":
			return void applyQueueTrigger(artifactId(key), value as TriggerArtifact | null).catch(
				(error) =>
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
		const definition = routeDefinition(artifact);
		projectParser(artifact.projectId).upsertRoute(definition);
		// with a subdomain the project answers there and nowhere else
		if (subdomainByProject.has(artifact.projectId)) parser.removeRoute(artifact.routeId);
		else parser.upsertRoute(definition);
	} catch (error) {
		// a graph that will not instantiate must not take the other routes down
		logger.error(
			`[worker] failed to load route ${artifact.routeId}: ${String(error)}`,
			"WORKER.compiled",
		);
	}
}

function addSandbox(artifact: RouteArtifact) {
	try {
		// no request schemas: a sandbox takes whatever it is sent
		sandboxes.set(artifact.routeId, {
			artifact,
			run: instantiateCompiled(artifact.source),
			validators: {},
		});
	} catch (error) {
		logger.error(
			`[worker] failed to load sandbox ${artifact.routeId}: ${String(error)}`,
			"WORKER.compiled",
		);
	}
}

function addMiddleware({ id, name, blocks }: MiddlewareArtifact) {
	middlewares.set(id, { id, name, blocks });
}

/**
 * A route's middleware ids, as the middlewares they name. One this worker does
 * not have fails the request: skipping it could skip an auth check.
 */
function resolveMiddlewares(ids?: RouteMiddlewareIds): RouteMiddlewares | undefined {
	if (!ids) return undefined;
	const resolve = (list: string[]) =>
		list.map((id) => {
			const middleware = middlewares.get(id);
			if (!middleware) throw new Error(`Middleware not loaded: ${id}`);
			return middleware;
		});
	return { before: resolve(ids.before), after: resolve(ids.after) };
}

function addWorkflow(artifact: WorkflowArtifact) {
	try {
		workflows.set(artifact.workflowId, {
			artifact,
			run: instantiateCompiled(artifact.source),
		});
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
		formBody: schemaValidator(artifact.bodySchema, true),
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
	const compiled = routes.get(routeId);
	if (compiled) {
		routes.delete(routeId);
		parser.removeRoute(routeId);
		projectParsers.get(compiled.artifact.projectId)?.removeRoute(routeId);
	}
}

function projectParser(projectId: string) {
	let trie = projectParsers.get(projectId);
	if (!trie) {
		trie = new HttpRouteParser();
		projectParsers.set(projectId, trie);
	}
	return trie;
}

/**
 * Moves the project's routes between the shared trie and its subdomain. Set
 * before routes load (config is applied first), so at boot nothing moves.
 */
function setProjectSubdomain(projectId: string, subdomain: string) {
	const previous = subdomainByProject.get(projectId) ?? "";
	if (previous === subdomain) return;
	if (previous && projectBySubdomain.get(previous) === projectId)
		projectBySubdomain.delete(previous);
	if (subdomain) {
		subdomainByProject.set(projectId, subdomain);
		projectBySubdomain.set(subdomain, projectId);
	} else {
		subdomainByProject.delete(projectId);
	}
	for (const { artifact } of routes.values()) {
		if (artifact.projectId !== projectId) continue;
		if (subdomain) parser.removeRoute(artifact.routeId);
		else parser.upsertRoute(routeDefinition(artifact));
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
		versionId: artifact.versionId,
	};
}

function addCustomBlock(artifact: CustomBlockArtifact) {
	try {
		registerCompiledCustomBlock(artifact.projectId, artifact.name, artifact.source, artifact.id);
	} catch (error) {
		logger.error(
			`[worker] failed to load custom block ${artifact.id}: ${String(error)}`,
			"WORKER.compiled",
		);
	}
}

/** already unsealed by the supervisor — the encryption key never enters this thread */
function applyProjectConfig(artifact: UnsealedProjectConfig) {
	const { payload } = artifact;
	// `missingValues` is what this environment has no value for (#733): reading
	// one throws, so a development route fails at use and says why
	hydrateAppConfig(artifact.projectId, payload.appConfig, payload.missingValues?.appConfig);
	hydrateIntegrations(
		artifact.projectId,
		{
			db: payload.dbIntegrations,
			kv: payload.kvIntegrations,
			observability: payload.observabilityIntegrations,
			ai: payload.aiIntegrations,
			queue: payload.queueIntegrations,
		},
		payload.missingValues?.integrations,
	);
	// The hydrated cache is the runtime's complete view. Swapping here makes
	// changed credentials available to new requests before old clients drain.
	dbConnectionManager?.synchronize(unguarded(dbIntegrationsCache));
	// same for KV clients: a rotated credential closes the old socket so the next
	// request builds a client from the new config
	KvFactory.synchronize(unguarded(kvIntegrationsCache));
	// and Send Message producers, which also publish over Redis KV integrations
	QueueProducerFactory.synchronize(
		unguarded(queueIntegrationsCache),
		unguarded(kvIntegrationsCache),
	);
	// same for queue consumers: rotated credentials restart, deleted ones stop
	void refreshQueueTriggers();
	devTokenHashes.set(artifact.projectId, payload.devTokenHash);
	hydrateProjectSettings(artifact.projectId, payload.projectSettings);
	setProjectSubdomain(
		artifact.projectId,
		payload.projectSettings?.["settings.routing.subdomain"] ?? "",
	);
}
