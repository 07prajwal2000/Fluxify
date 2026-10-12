import { compileGraph } from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import { and, eq, or } from "drizzle-orm";
import { db } from "../../db";
import { deleteArtifactEverywhere } from "../../db/natsKv";
import {
	httpRouteConfigEntity,
	projectsEntity,
	routesEntity,
	workflowsEntity,
} from "../../db/schema";
import { acceptedContentTypes } from "../../lib/routeConfig";
import { compileDependencies } from "../packages/service";
import { readSnapshot } from "../versions/repository";
import type { RouteArtifact, WorkflowArtifact } from "./artifacts";
import {
	type CompiledResource,
	compileOrThrow,
	logCompiled,
	logInactive,
	recordFailure,
} from "./compileLog";
import { ensureCustomBlocksRegistered } from "./customBlocks";
import { loadGraph, snapshotGraph } from "./graph";
import { loadRouteMiddlewareIds } from "./middlewares";
import { compilePerEnv, isServedIn, type PerEnv, putPerEnv } from "./observability";
import { publishProjectConfig } from "./projectConfig";
import { routeKey, workflowKey } from "./subjects";

// Custom blocks and middlewares, and the compile log, live in their own files
// (#740); the rest of the server still reaches them through here.
export {
	COMPILE_LOG_TYPE,
	type CompiledResource,
	type CompileStatus,
	compileOrThrow,
	logCompiled,
	recordFailure,
} from "./compileLog";
export {
	compileCustomBlock,
	compileMiddleware,
	compileProjectCustomBlocks,
	compileProjectMiddlewares,
	dropCustomBlock,
	ensureCustomBlocksRegistered,
} from "./customBlocks";
export { compilerGraph, loadGraph, snapshotGraph } from "./graph";
export { publishProjectConfig };

/**
 * The compiler is the only process that reads graphs from the database. It
 * turns them into JavaScript and publishes the result to the artifact store,
 * so request workers never query Postgres to serve a request.
 */

/** what a route's build adds to the shared artifact for one environment */
type RouteEnvBuild = Pick<
	RouteArtifact,
	| "source"
	| "method"
	| "path"
	| "bodySchema"
	| "querySchema"
	| "paramsSchema"
	| "timeoutSeconds"
	| "middlewares"
	| "routeVersion"
	| "versionId"
>;
type WorkflowEnvBuild = Pick<
	WorkflowArtifact,
	"source" | "timeoutSeconds" | "workflowVersion" | "versionId"
>;

export async function compileProjectRoutes(projectId: string) {
	const routes = await db
		.select({ id: routesEntity.id })
		.from(routesEntity)
		.where(
			and(
				eq(routesEntity.projectId, projectId),
				or(eq(routesEntity.active, true), eq(routesEntity.devActive, true)),
			),
		);
	for (const route of routes) await compileRoute(route.id);
	return routes.length;
}

export async function compileProjectWorkflows(projectId: string) {
	const workflows = await db
		.select({ id: workflowsEntity.id })
		.from(workflowsEntity)
		.where(
			and(
				eq(workflowsEntity.projectId, projectId),
				or(eq(workflowsEntity.active, true), eq(workflowsEntity.devActive, true)),
			),
		);
	for (const workflow of workflows) await compileWorkflow(workflow.id);
	return workflows.length;
}

/**
 * compile one route and publish it where it is served: development where
 * `devActive` is on, production where `active` is on and a version is promoted.
 * One served nowhere, or deleted, is dropped.
 */
export async function compileRoute(routeId: string) {
	const [route] = await db
		.select({
			id: routesEntity.id,
			method: routesEntity.method,
			path: routesEntity.path,
			active: routesEntity.active,
			devActive: routesEntity.devActive,
			prodVersionId: routesEntity.prodVersionId,
			projectId: routesEntity.projectId,
			projectName: projectsEntity.name,
			bodySchema: routesEntity.bodySchema,
			querySchema: routesEntity.querySchema,
			paramsSchema: routesEntity.paramsSchema,
			timeoutSeconds: routesEntity.timeoutSeconds,
			tracingEnabled: routesEntity.tracingEnabled,
			recordExecution: routesEntity.recordExecution,
			devTracingEnabled: routesEntity.devTracingEnabled,
			devRecordExecution: routesEntity.devRecordExecution,
			routeConfig: httpRouteConfigEntity.routeConfig,
		})
		.from(routesEntity)
		.leftJoin(projectsEntity, eq(routesEntity.projectId, projectsEntity.id))
		.leftJoin(httpRouteConfigEntity, eq(httpRouteConfigEntity.routeId, routesEntity.id))
		.where(eq(routesEntity.id, routeId));

	if (!route || (!isServedIn(route, "development") && !isServedIn(route, "production"))) {
		logger.info(`[compiler] dropping route ${routeId}`, "COMPILER");
		if (route?.projectId) {
			await dropRoute(route.projectId, routeId);
			await logInactive(
				{ projectId: route.projectId, resourceType: "route", resourceId: routeId },
				route,
			);
		}
		return;
	}
	const resource: CompiledResource = {
		projectId: route.projectId!,
		resourceType: "route",
		resourceId: routeId,
	};

	// a route that calls a custom block only emits if that block is in this
	// process's library — the artifact in KV is for workers, not for us
	await ensureCustomBlocksRegistered(route.projectId!);

	const compiledAt = new Date().toISOString();
	const workingCopy = isServedIn(route, "development")
		? await loadGraph({ type: "route", id: routeId })
		: undefined;
	const snapshot = isServedIn(route, "production")
		? await readSnapshot(route.prodVersionId!)
		: undefined;
	const dependencies = await compileDependencies(route.projectId!);
	const workingMiddlewares = await loadRouteMiddlewareIds(routeId);
	let perEnv: PerEnv<RouteEnvBuild>;
	try {
		perEnv = compilePerEnv(route, (env, tracing) => {
			const production = env === "production";
			const graph = production ? snapshotGraph(snapshot!) : workingCopy!;
			const settings = production ? snapshot!.settings : route;
			const middlewares = production ? snapshot!.settings.middlewares : workingMiddlewares;
			return {
				source: compileOrThrow(resource, () =>
					compileGraph(graph.blocks, graph.edges, {
						projectId: route.projectId!,
						dependencies,
						tracing,
					}),
				).source,
				method: settings.method ?? "GET",
				path: settings.path ?? "",
				bodySchema: settings.bodySchema,
				querySchema: settings.querySchema,
				paramsSchema: settings.paramsSchema,
				timeoutSeconds: settings.timeoutSeconds,
				middlewares:
					middlewares?.before.length || middlewares?.after.length ? middlewares : undefined,
				// production's version is the promoted one; development has no version
				// of its own, so the compile timestamp tells its builds apart
				routeVersion: production ? route.prodVersionId! : compiledAt,
				// the version this build serves (#782): production's promoted version,
				// nothing in development, which runs the working copy
				versionId: production ? route.prodVersionId! : undefined,
			};
		});
	} catch (error) {
		return recordFailure(error);
	}

	const artifact: Pick<
		RouteArtifact,
		"routeId" | "projectId" | "projectName" | "acceptedContentTypes" | "compiledAt"
	> = {
		routeId,
		projectId: route.projectId!,
		projectName: route.projectName ?? "",
		acceptedContentTypes: acceptedContentTypes(route.routeConfig),
		compiledAt,
	};
	await putPerEnv(routeKey(route.projectId!, routeId), artifact, perEnv, route);
	await logCompiled(resource);
	logger.info(`[compiler] compiled route ${route.method} ${route.path}`, "COMPILER");
}

export async function dropRoute(projectId: string, routeId: string) {
	await deleteArtifactEverywhere(routeKey(projectId, routeId));
}

/**
 * Compile one workflow and publish it; an inactive or deleted one is dropped.
 *
 * Same compiler, same artifact store, same custom block library as a route —
 * only the entity it reads and the shape it publishes differ. The compiler is
 * told one thing (`asWorkflow`), and it is about a block that has no job here,
 * not about a second way of compiling a graph.
 */
export async function compileWorkflow(workflowId: string) {
	const [workflow] = await db
		.select({
			id: workflowsEntity.id,
			name: workflowsEntity.name,
			active: workflowsEntity.active,
			devActive: workflowsEntity.devActive,
			prodVersionId: workflowsEntity.prodVersionId,
			projectId: workflowsEntity.projectId,
			projectName: projectsEntity.name,
			timeoutSeconds: workflowsEntity.timeoutSeconds,
			tracingEnabled: workflowsEntity.tracingEnabled,
			recordExecution: workflowsEntity.recordExecution,
			devTracingEnabled: workflowsEntity.devTracingEnabled,
			devRecordExecution: workflowsEntity.devRecordExecution,
		})
		.from(workflowsEntity)
		.leftJoin(projectsEntity, eq(workflowsEntity.projectId, projectsEntity.id))
		.where(eq(workflowsEntity.id, workflowId));

	if (!workflow || (!isServedIn(workflow, "development") && !isServedIn(workflow, "production"))) {
		logger.info(`[compiler] dropping workflow ${workflowId}`, "COMPILER");
		if (workflow?.projectId) {
			await dropWorkflow(workflow.projectId, workflowId);
			await logInactive(
				{ projectId: workflow.projectId, resourceType: "workflow", resourceId: workflowId },
				workflow,
			);
		}
		return;
	}
	const resource: CompiledResource = {
		projectId: workflow.projectId!,
		resourceType: "workflow",
		resourceId: workflowId,
	};

	await ensureCustomBlocksRegistered(workflow.projectId!);

	const compiledAt = new Date().toISOString();
	const workingCopy = isServedIn(workflow, "development")
		? await loadGraph({ type: "workflow", id: workflowId })
		: undefined;
	const snapshot = isServedIn(workflow, "production")
		? await readSnapshot(workflow.prodVersionId!)
		: undefined;
	const dependencies = await compileDependencies(workflow.projectId!);
	let perEnv: PerEnv<WorkflowEnvBuild>;
	try {
		// `asWorkflow` is the one thing the compiler is told: a response block has
		// nothing to respond to here, so it compiles to a plain terminal.
		perEnv = compilePerEnv(workflow, (env, tracing) => {
			const production = env === "production";
			const graph = production ? snapshotGraph(snapshot!) : workingCopy!;
			return {
				source: compileOrThrow(resource, () =>
					compileGraph(graph.blocks, graph.edges, {
						asWorkflow: true,
						projectId: workflow.projectId!,
						dependencies,
						tracing,
					}),
				).source,
				timeoutSeconds: production ? snapshot!.settings.timeoutSeconds : workflow.timeoutSeconds,
				workflowVersion: production ? workflow.prodVersionId! : compiledAt,
				versionId: production ? workflow.prodVersionId! : undefined,
			};
		});
	} catch (error) {
		return recordFailure(error);
	}

	const artifact: Pick<
		WorkflowArtifact,
		"workflowId" | "projectId" | "projectName" | "name" | "compiledAt"
	> = {
		workflowId,
		projectId: workflow.projectId!,
		projectName: workflow.projectName ?? "",
		name: workflow.name ?? "",
		compiledAt,
	};
	await putPerEnv(workflowKey(workflow.projectId!, workflowId), artifact, perEnv, workflow);
	await logCompiled(resource);
	logger.info(`[compiler] compiled workflow ${workflow.name}`, "COMPILER");
}

export async function dropWorkflow(projectId: string, workflowId: string) {
	await deleteArtifactEverywhere(workflowKey(projectId, workflowId));
}

/** app config and integrations are global caches, so a change touches everyone */
export async function publishAllProjectConfigs() {
	const projects = await db.select({ id: projectsEntity.id }).from(projectsEntity);
	for (const project of projects) await publishProjectConfig(project.id);
}
