import { logger } from "@fluxify/common";
import {
	BlockTypes,
	compileGraph,
	hasCustomBlock,
	registerCompiledCustomBlock,
	unregisterCustomBlock,
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
	workflowsEntity,
} from "../../db/schema";
import { acceptedContentTypes } from "../../lib/routeConfig";
import { deleteArtifact, putArtifact } from "../../db/natsKv";
import type { CanvasParent } from "../canvas/types";
import { parentColumn } from "../canvas/repository";
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
	WorkflowArtifact,
} from "./artifacts";
import { EncryptionService } from "../../lib/encryption";
import {
	customBlockKey,
	projectConfigKey,
	routeKey,
	workflowKey,
} from "./subjects";

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
	const workflows = await compileProjectWorkflows(projectId);
	logger.info(
		`[compiler] project ${projectId}: ${routes} routes, ${workflows} workflows, ${blocks} custom blocks`,
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

export async function compileProjectWorkflows(projectId: string) {
	const workflows = await db
		.select({ id: workflowsEntity.id })
		.from(workflowsEntity)
		.where(
			and(
				eq(workflowsEntity.projectId, projectId),
				eq(workflowsEntity.active, true),
			),
		);
	for (const workflow of workflows) await compileWorkflow(workflow.id);
	return workflows.length;
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

	// a route that calls a custom block only emits if that block is in this
	// process's library — the artifact in KV is for workers, not for us
	await ensureCustomBlocksRegistered(route.projectId!);

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
			projectId: workflowsEntity.projectId,
			projectName: projectsEntity.name,
			timeoutSeconds: workflowsEntity.timeoutSeconds,
			tracingEnabled: workflowsEntity.tracingEnabled,
			recordExecution: workflowsEntity.recordExecution,
		})
		.from(workflowsEntity)
		.leftJoin(projectsEntity, eq(workflowsEntity.projectId, projectsEntity.id))
		.where(eq(workflowsEntity.id, workflowId));

	if (!workflow || !workflow.active) {
		logger.info(`[compiler] dropping workflow ${workflowId}`, "COMPILER");
		if (workflow?.projectId) await dropWorkflow(workflow.projectId, workflowId);
		return;
	}

	await ensureCustomBlocksRegistered(workflow.projectId!);

	const { blocks, edges } = await loadGraph({ type: "workflow", id: workflowId });
	// `asWorkflow` is the one thing the compiler is told: a response block has
	// nothing to respond to here, so it compiles to a plain terminal.
	const { source } = compileGraph(blocks, edges, { asWorkflow: true });

	const compiledAt = new Date().toISOString();
	const artifact: WorkflowArtifact = {
		workflowId,
		projectId: workflow.projectId!,
		projectName: workflow.projectName ?? "",
		name: workflow.name ?? "",
		timeoutSeconds: workflow.timeoutSeconds,
		tracingEnabled: workflow.tracingEnabled,
		recordExecution: workflow.recordExecution,
		workflowVersion: compiledAt,
		source,
		compiledAt,
	};
	await putArtifact(workflowKey(workflow.projectId!, workflowId), artifact);
	logger.info(`[compiler] compiled workflow ${workflow.name}`, "COMPILER");
}

export async function dropWorkflow(projectId: string, workflowId: string) {
	await deleteArtifact(workflowKey(projectId, workflowId));
}

/** custom blocks being compiled right now — see `ensureCustomBlocksRegistered` */
const inFlight = new Set<string>();
/** what each custom block id is registered as, so a rename or delete can undo it */
const registeredNames = new Map<string, string>();

function registerLocally(id: string, name: string, source: string) {
	const previous = registeredNames.get(id);
	// a rename would otherwise leave the old name resolving to this block forever
	if (previous && previous !== name) unregisterCustomBlock(previous);
	registerCompiledCustomBlock(name, source);
	registeredNames.set(id, name);
}

function unregisterLocally(id: string) {
	const name = registeredNames.get(id);
	if (!name) return;
	unregisterCustomBlock(name);
	registeredNames.delete(id);
}

/**
 * Makes sure every custom block of a project is in this process's library
 * before something that may call one is compiled.
 *
 * Compiling publishes an artifact for the workers; it does not make the block
 * callable here, and `compileGraph` resolves a non-builtin type by asking the
 * library. Without this, a route compile that happens before the block's own
 * compile — a route saved after a restart, a fresh consumer — fails with
 * "No codegen for block type".
 *
 * Order is discovered rather than declared: a block that calls another is
 * retried once its callee lands. Cycles are impossible (the canvas save
 * refuses them), so the fixpoint always terminates.
 */
async function ensureCustomBlocksRegistered(projectId: string) {
	const rows = await db
		.select({ id: customBlocksListEntity.id, name: customBlocksListEntity.name })
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.projectId, projectId));

	let pending = rows.filter(
		(row) => !hasCustomBlock(row.name) && !inFlight.has(row.id),
	);
	while (pending.length > 0) {
		const failed: typeof pending = [];
		const errors = new Map<string, unknown>();
		for (const row of pending) {
			try {
				await compileCustomBlock(row.id);
			} catch (error) {
				errors.set(row.id, error);
				failed.push(row);
			}
		}
		// Nothing compiled this pass, so the failures are real rather than
		// ordering. Report them and stop retrying, but do not fail the caller:
		// this runs before *every* route compile, so rethrowing here took every
		// route in the project down over one unrelated custom block. A route that
		// actually calls a broken block still fails on its own, and does it with
		// the specific "No codegen for block type: <name>" that names the culprit.
		if (failed.length === pending.length) {
			for (const row of failed) {
				logger.error(
					`[compiler] custom block ${row.name} did not compile`,
					"COMPILER",
					{ error: errors.get(row.id) },
				);
			}
			return;
		}
		pending = failed;
	}
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
		unregisterLocally(id);
		return;
	}

	// a custom block may call another one; same library requirement as a route
	inFlight.add(id);
	let source: string;
	try {
		await ensureCustomBlocksRegistered(block.projectId!);
		const { blocks, edges } = await loadGraph({ type: "custom_block", id });
		// `param:` placeholders resolve from the invocation, not from a caller's data
		({ source } = compileGraph(blocks, edges, { asCustomBlock: true }));
	} finally {
		inFlight.delete(id);
	}
	// the compiler is also a consumer of its own output: the next route to call
	// this block resolves it from here
	registerLocally(block.id, block.name, source);

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
	unregisterLocally(id);
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
				eq(parentColumn(blocksEntity, parent.type), parent.id),
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
			eq(parentColumn(edgesEntity, parent.type), parent.id),
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

