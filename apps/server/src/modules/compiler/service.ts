import { logger } from "@fluxify/common";
import {
	BlockTypes,
	compileGraph,
	type BlockDTOType,
	type EdgeDTOSchemaType,
} from "@fluxify/blocks";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../../db";
import {
	blocksEntity,
	customBlocksListEntity,
	edgesEntity,
	httpRouteConfigEntity,
	projectsEntity,
	routesEntity,
} from "../../db/schema";
import { acceptedContentTypes } from "../../lib/routeConfig";
import { deleteArtifact, putArtifact } from "../../db/natsKv";
import type { CanvasParent } from "../canvas/types";
import { getProjectAppConfig } from "../../loaders/appconfigLoader";
import {
	aiIntegrationsCache,
	dbIntegrationsCache,
	kvIntegrationsCache,
	observabilityIntegrationsCache,
	scopeToProject,
} from "../../loaders/integrationsLoader";
import { projectSettingsCache } from "../../loaders/projectSettingsLoader";
import type {
	CustomBlockArtifact,
	ProjectConfigArtifact,
	ProjectConfigPayload,
	RouteArtifact,
} from "./artifacts";
import { EncryptionService } from "../../lib/encryption";
import { customBlockKey, projectConfigKey, routeKey } from "./subjects";

/**
 * The compiler is the only process that reads graphs from the database. It
 * turns them into JavaScript and publishes the result to the artifact store,
 * so request workers never query Postgres to serve a request.
 *
 * Custom blocks are compiled first when rebuilding a whole project: a route
 * that calls one only compiles if that block is already in the library.
 */

/**
 * Cold start: compile every project once. The KV bucket can legitimately be
 * empty (fresh deployment, purged bucket, new NATS cluster) and nothing else
 * would ever refill it — the change signals only fire on an edit, so without
 * this a worker booting against an empty bucket serves nothing until somebody
 * happens to save a route. Idempotent: recompiling just overwrites the key.
 */
export async function compileAllProjects() {
	const projects = await db.select({ id: projectsEntity.id }).from(projectsEntity);
	for (const project of projects) await compileProject(project.id);
	return projects.length;
}

export async function compileProject(projectId: string) {
	await publishProjectConfig(projectId);
	const blocks = await compileProjectCustomBlocks(projectId);
	const routes = await compileProjectRoutes(projectId);
	logger.info(
		`[compiler] project ${projectId}: ${routes} routes, ${blocks} custom blocks`,
		"COMPILER",
	);
}

export async function compileProjectRoutes(projectId: string) {
	const routes = await db
		.select({ id: routesEntity.id })
		.from(routesEntity)
		.where(
			and(eq(routesEntity.projectId, projectId), eq(routesEntity.active, true)),
		);
	for (const route of routes) await compileRoute(route.id);
	return routes.length;
}

export async function compileProjectCustomBlocks(projectId: string) {
	const blocks = await db
		.select({ id: customBlocksListEntity.id })
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.projectId, projectId));
	for (const block of blocks) await compileCustomBlock(block.id);
	return blocks.length;
}

/** compile one route and publish it; an inactive or deleted route is dropped */
export async function compileRoute(routeId: string) {
	const [route] = await db
		.select({
			id: routesEntity.id,
			method: routesEntity.method,
			path: routesEntity.path,
			active: routesEntity.active,
			projectId: routesEntity.projectId,
			projectName: projectsEntity.name,
			bodySchema: routesEntity.bodySchema,
			querySchema: routesEntity.querySchema,
			paramsSchema: routesEntity.paramsSchema,
			timeoutSeconds: routesEntity.timeoutSeconds,
			tracingEnabled: routesEntity.tracingEnabled,
			recordExecution: routesEntity.recordExecution,
			routeConfig: httpRouteConfigEntity.routeConfig,
		})
		.from(routesEntity)
		.leftJoin(projectsEntity, eq(routesEntity.projectId, projectsEntity.id))
		.leftJoin(
			httpRouteConfigEntity,
			eq(httpRouteConfigEntity.routeId, routesEntity.id),
		)
		.where(eq(routesEntity.id, routeId));

	if (!route || !route.active) {
		logger.info(`[compiler] dropping route ${routeId}`, "COMPILER");
		if (route?.projectId) await dropRoute(route.projectId, routeId);
		return;
	}

	const { blocks, edges } = await loadGraph({ type: "route", id: routeId });
	const { source } = compileGraph(blocks, edges);

	const compiledAt = new Date().toISOString();
	const artifact: RouteArtifact = {
		routeId,
		projectId: route.projectId!,
		projectName: route.projectName ?? "",
		method: route.method ?? "GET",
		path: route.path ?? "",
		bodySchema: route.bodySchema,
		querySchema: route.querySchema,
		paramsSchema: route.paramsSchema,
		timeoutSeconds: route.timeoutSeconds,
		acceptedContentTypes: acceptedContentTypes(route.routeConfig),
		tracingEnabled: route.tracingEnabled,
		recordExecution: route.recordExecution,
		// no versioning yet — the compile timestamp is the version (see RouteArtifact)
		routeVersion: compiledAt,
		source,
		compiledAt,
	};
	await putArtifact(routeKey(route.projectId!, routeId), artifact);
	logger.info(`[compiler] compiled route ${route.method} ${route.path}`, "COMPILER");
}

export async function dropRoute(projectId: string, routeId: string) {
	await deleteArtifact(routeKey(projectId, routeId));
}

/** compile one custom block; a deleted one is dropped from the library */
export async function compileCustomBlock(id: string) {
	const [block] = await db
		.select({
			id: customBlocksListEntity.id,
			name: customBlocksListEntity.name,
			projectId: customBlocksListEntity.projectId,
		})
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.id, id));

	if (!block) {
		logger.info(`[compiler] dropping custom block ${id}`, "COMPILER");
		return;
	}

	const { blocks, edges } = await loadGraph({ type: "custom_block", id });
	// `param:` placeholders resolve from the invocation, not from a caller's data
	const { source } = compileGraph(blocks, edges, { asCustomBlock: true });

	const artifact: CustomBlockArtifact = {
		id: block.id,
		name: block.name,
		projectId: block.projectId!,
		source,
		compiledAt: new Date().toISOString(),
	};
	await putArtifact(customBlockKey(block.projectId!, block.id), artifact);
	logger.info(`[compiler] compiled custom block ${block.name}`, "COMPILER");
}

export async function dropCustomBlock(projectId: string, id: string) {
	await deleteArtifact(customBlockKey(projectId, id));
}

/**
 * Publishes the resolved caches a worker would otherwise have built from the
 * database at boot. Values are already decrypted and integration configs are
 * already resolved, so the worker only has to hydrate them.
 */
/** app config and integrations are global caches, so a change touches everyone */
export async function publishAllProjectConfigs() {
	const projects = await db.select({ id: projectsEntity.id }).from(projectsEntity);
	for (const project of projects) await publishProjectConfig(project.id);
}

export async function publishProjectConfig(projectId: string) {
	const payload: ProjectConfigPayload = {
		appConfig: (getProjectAppConfig(projectId) ?? {}) as Record<
			string,
			string | number | boolean
		>,
		// scoped, not the whole cache: an artifact is per project, so shipping the
		// global cache would put every tenant's database password in every other
		// tenant's worker
		dbIntegrations: scopeToProject(dbIntegrationsCache, projectId),
		kvIntegrations: scopeToProject(kvIntegrationsCache, projectId),
		observabilityIntegrations: scopeToProject(
			observabilityIntegrationsCache,
			projectId,
		),
		aiIntegrations: scopeToProject(aiIntegrationsCache, projectId),
		projectSettings: (projectSettingsCache[projectId] ?? {}) as Record<
			string,
			string
		>,
	};
	// sealed, not plaintext: KV would otherwise hold every tenant's database
	// password in the clear for anyone who can read the bucket
	const artifact: ProjectConfigArtifact = {
		projectId,
		sealed: EncryptionService.encrypt(JSON.stringify(payload)),
		compiledAt: new Date().toISOString(),
	};
	await putArtifact(projectConfigKey(projectId), artifact);
}

/**
 * Exported for the test runner: a suite runs the canvas as it is saved right
 * now, not the last published artifact, so it compiles the graph itself rather
 * than reading the artifact store.
 */
export async function loadGraph(parent: CanvasParent) {
	const blockRows = await db
		.select()
		.from(blocksEntity)
		.where(
			and(
				eq(blocksEntity.parentType, parent.type),
				eq(blocksEntity.parentId, parent.id),
				ne(blocksEntity.type, BlockTypes.sticky_note),
			),
		);

	const blocks: BlockDTOType[] = blockRows
		.filter((block) => block.type !== null)
		.map((block) => ({
			id: block.id,
			type: block.type as string,
			position: block.position as { x: number; y: number },
			data: block.data,
		}));

	const edgeRows = await db
		.select({
			id: edgesEntity.id,
			from: edgesEntity.from,
			to: edgesEntity.to,
			fromHandle: edgesEntity.fromHandle,
			toHandle: edgesEntity.toHandle,
		})
		.from(edgesEntity)
		.where(
			and(
				eq(edgesEntity.parentType, parent.type),
				eq(edgesEntity.parentId, parent.id),
			),
		);

	// the loader swaps the handles; keep the compiler on the same convention
	const edges = edgeRows.map((edge) => ({
		id: edge.id as string,
		from: edge.from as string,
		to: edge.to as string,
		fromHandle: edge.toHandle as string,
		toHandle: edge.fromHandle as string,
	})) as EdgeDTOSchemaType;

	return { blocks, edges };
}

