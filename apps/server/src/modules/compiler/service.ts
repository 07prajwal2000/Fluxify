import {
	type BlockDTOType,
	BlockTypes,
	compileGraph,
	type EdgeDTOSchemaType,
	hasCustomBlock,
	registerCompiledCustomBlock,
	unregisterCustomBlock,
} from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../../db";
import { deleteArtifactEverywhere, putArtifactEverywhere } from "../../db/natsKv";
import {
	blocksEntity,
	customBlocksListEntity,
	edgesEntity,
	httpRouteConfigEntity,
	middlewaresEntity,
	projectsEntity,
	routesEntity,
	workflowsEntity,
} from "../../db/schema";
import { acceptedContentTypes } from "../../lib/routeConfig";
import { systemLog } from "../../lib/systemLogs";
import { parentColumn } from "../canvas/repository";
import type { CanvasParent, CanvasParentType } from "../canvas/types";
import { compileDependencies } from "../packages/service";
import { wantsSpans } from "../requestRouter/traceLifecycle";
import type {
	CustomBlockArtifact,
	MiddlewareArtifact,
	RouteArtifact,
	WorkflowArtifact,
} from "./artifacts";
import { loadMiddleware, loadRouteMiddlewareIds } from "./middlewares";
import { publishProjectConfig } from "./projectConfig";
import { customBlockKey, middlewareKey, routeKey, workflowKey } from "./subjects";

export { publishProjectConfig };

/**
 * The compiler is the only process that reads graphs from the database. It
 * turns them into JavaScript and publishes the result to the artifact store,
 * so request workers never query Postgres to serve a request.
 *
 * Custom blocks are compiled first when rebuilding a whole project: a route
 * that calls one only compiles if that block is already in the library.
 */

/** `type` of every system log the compiler writes; the canvas reads the latest */
export const COMPILE_LOG_TYPE = "compile";

export type CompiledResource = {
	projectId: string;
	resourceType: CanvasParentType;
	resourceId: string;
};

/**
 * A graph that cannot compile. Retrying will not change the answer, so this is
 * recorded for the user instead of being thrown back at the queue — a db or
 * NATS failure still throws and is retried.
 */
class StaticCompileError extends Error {
	constructor(
		readonly resource: CompiledResource,
		cause: unknown,
	) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
	}
}

export function compileOrThrow<T>(resource: CompiledResource, compile: () => T): T {
	try {
		return compile();
	} catch (error) {
		throw new StaticCompileError(resource, error);
	}
}

/** `detail.status` of a compile log — what the canvas keys on, never the message */
export type CompileStatus = "compiled" | "inactive" | "failed";

export const logCompiled = (resource: CompiledResource) =>
	systemLog.info({
		...resource,
		type: COMPILE_LOG_TYPE,
		message: "Compiled",
		detail: { status: "compiled" satisfies CompileStatus },
	});

const logInactive = (resource: CompiledResource) =>
	systemLog.info({
		...resource,
		type: COMPILE_LOG_TYPE,
		message: `This ${resource.resourceType} is inactive, so it is not deployed`,
		detail: { status: "inactive" satisfies CompileStatus },
	});

const logCompileFailed = (error: StaticCompileError) =>
	systemLog.error({
		...error.resource,
		type: COMPILE_LOG_TYPE,
		message: error.message,
		detail: { status: "failed" satisfies CompileStatus },
	});

/** records a static failure; anything else goes back to the queue for a retry */
export async function recordFailure(error: unknown) {
	if (!(error instanceof StaticCompileError)) throw error;
	await logCompileFailed(error);
}

export async function compileProjectRoutes(projectId: string) {
	const routes = await db
		.select({ id: routesEntity.id })
		.from(routesEntity)
		.where(and(eq(routesEntity.projectId, projectId), eq(routesEntity.active, true)));
	for (const route of routes) await compileRoute(route.id);
	return routes.length;
}

export async function compileProjectWorkflows(projectId: string) {
	const workflows = await db
		.select({ id: workflowsEntity.id })
		.from(workflowsEntity)
		.where(and(eq(workflowsEntity.projectId, projectId), eq(workflowsEntity.active, true)));
	for (const workflow of workflows) await compileWorkflow(workflow.id);
	return workflows.length;
}

export async function compileProjectMiddlewares(projectId: string) {
	const rows = await db
		.select({ id: middlewaresEntity.id })
		.from(middlewaresEntity)
		.where(eq(middlewaresEntity.projectId, projectId));
	for (const row of rows) await compileMiddleware(row.id);
}

/**
 * Publish one middleware (#579); a deleted one is dropped, which needs the
 * project its key lives under since the row is gone.
 */
export async function compileMiddleware(id: string, projectId?: string) {
	const loaded = await loadMiddleware(id);
	if (!loaded) {
		if (projectId) await deleteArtifactEverywhere(middlewareKey(projectId, id));
		return;
	}
	const artifact: MiddlewareArtifact = {
		...loaded.middleware,
		projectId: loaded.projectId,
		compiledAt: new Date().toISOString(),
	};
	await putArtifactEverywhere(middlewareKey(loaded.projectId, id), artifact);
	logger.info(`[compiler] published middleware ${artifact.name}`, "COMPILER");
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
		.leftJoin(httpRouteConfigEntity, eq(httpRouteConfigEntity.routeId, routesEntity.id))
		.where(eq(routesEntity.id, routeId));

	if (!route || !route.active) {
		logger.info(`[compiler] dropping route ${routeId}`, "COMPILER");
		if (route?.projectId) {
			await dropRoute(route.projectId, routeId);
			await logInactive({ projectId: route.projectId, resourceType: "route", resourceId: routeId });
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

	const { blocks, edges } = await loadGraph({ type: "route", id: routeId });
	const dependencies = await compileDependencies(route.projectId!);
	let source: string;
	try {
		({ source } = compileOrThrow(resource, () =>
			compileGraph(blocks, edges, {
				projectId: route.projectId!,
				dependencies,
				tracing: wantsSpans(route),
			}),
		));
	} catch (error) {
		return recordFailure(error);
	}

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
		middlewares: await loadRouteMiddlewareIds(routeId),
		compiledAt,
	};
	await putArtifactEverywhere(routeKey(route.projectId!, routeId), artifact);
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
		if (workflow?.projectId) {
			await dropWorkflow(workflow.projectId, workflowId);
			await logInactive({
				projectId: workflow.projectId,
				resourceType: "workflow",
				resourceId: workflowId,
			});
		}
		return;
	}
	const resource: CompiledResource = {
		projectId: workflow.projectId!,
		resourceType: "workflow",
		resourceId: workflowId,
	};

	await ensureCustomBlocksRegistered(workflow.projectId!);

	const { blocks, edges } = await loadGraph({ type: "workflow", id: workflowId });
	const dependencies = await compileDependencies(workflow.projectId!);
	let source: string;
	try {
		// `asWorkflow` is the one thing the compiler is told: a response block has
		// nothing to respond to here, so it compiles to a plain terminal.
		({ source } = compileOrThrow(resource, () =>
			compileGraph(blocks, edges, {
				asWorkflow: true,
				projectId: workflow.projectId!,
				dependencies,
				tracing: wantsSpans(workflow),
			}),
		));
	} catch (error) {
		return recordFailure(error);
	}

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
	await putArtifactEverywhere(workflowKey(workflow.projectId!, workflowId), artifact);
	await logCompiled(resource);
	logger.info(`[compiler] compiled workflow ${workflow.name}`, "COMPILER");
}

export async function dropWorkflow(projectId: string, workflowId: string) {
	await deleteArtifactEverywhere(workflowKey(projectId, workflowId));
}

/** custom blocks being compiled right now — see `ensureCustomBlocksRegistered` */
const inFlight = new Set<string>();
/** what each custom block id is registered as, so a rename or delete can undo it */
const registeredNames = new Map<string, { projectId: string; name: string }>();

function registerLocally(id: string, projectId: string, name: string, source: string) {
	const previous = registeredNames.get(id);
	// a rename would otherwise leave the old name resolving to this block forever
	if (previous && previous.name !== name) unregisterCustomBlock(projectId, previous.name);
	registerCompiledCustomBlock(projectId, name, source);
	registeredNames.set(id, { projectId, name });
}

function unregisterLocally(id: string) {
	const registered = registeredNames.get(id);
	if (!registered) return;
	unregisterCustomBlock(registered.projectId, registered.name);
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
export async function ensureCustomBlocksRegistered(projectId: string) {
	const rows = await db
		.select({ id: customBlocksListEntity.id, name: customBlocksListEntity.name })
		.from(customBlocksListEntity)
		// a test block is never in the live library (see compileCustomBlockOrThrow)
		.where(
			and(
				eq(customBlocksListEntity.projectId, projectId),
				ne(customBlocksListEntity.usage, "test"),
			),
		);

	let pending = rows.filter((row) => !hasCustomBlock(projectId, row.name) && !inFlight.has(row.id));
	while (pending.length > 0) {
		const failed: typeof pending = [];
		const errors = new Map<string, unknown>();
		for (const row of pending) {
			try {
				await compileCustomBlockOrThrow(row.id);
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
				const error = errors.get(row.id);
				if (!(error instanceof StaticCompileError)) {
					logger.error(`[compiler] custom block ${row.name} did not compile`, "COMPILER", {
						error,
					});
					continue;
				}
				await logCompileFailed(error);
			}
			return;
		}
		pending = failed;
	}
}

/** compile one custom block; a deleted one is dropped from the library */
export async function compileCustomBlock(id: string) {
	try {
		await compileCustomBlockOrThrow(id);
	} catch (error) {
		await recordFailure(error);
	}
}

async function compileCustomBlockOrThrow(id: string) {
	const [block] = await db
		.select({
			id: customBlocksListEntity.id,
			name: customBlocksListEntity.name,
			projectId: customBlocksListEntity.projectId,
			usage: customBlocksListEntity.usage,
		})
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.id, id));

	if (!block) {
		logger.info(`[compiler] dropping custom block ${id}`, "COMPILER");
		unregisterLocally(id);
		return;
	}
	// test-only (#483): the test runner compiles it itself; workers never get it,
	// and switching a published block to test takes it back off them
	if (block.usage === "test") {
		await dropCustomBlock(block.projectId!, block.id);
		return;
	}

	const resource: CompiledResource = {
		projectId: block.projectId!,
		resourceType: "custom_block",
		resourceId: block.id,
	};

	// a custom block may call another one; same library requirement as a route
	inFlight.add(id);
	let source: string;
	try {
		await ensureCustomBlocksRegistered(block.projectId!);
		const { blocks, edges } = await loadGraph({ type: "custom_block", id });
		const dependencies = await compileDependencies(block.projectId!);
		// `param:` placeholders resolve from the invocation, not from a caller's data
		({ source } = compileOrThrow(resource, () =>
			compileGraph(blocks, edges, {
				asCustomBlock: true,
				projectId: block.projectId!,
				dependencies,
			}),
		));
	} finally {
		inFlight.delete(id);
	}
	// the compiler is also a consumer of its own output: the next route to call
	// this block resolves it from here
	registerLocally(block.id, block.projectId!, block.name, source);

	const artifact: CustomBlockArtifact = {
		id: block.id,
		name: block.name,
		projectId: block.projectId!,
		source,
		compiledAt: new Date().toISOString(),
	};
	await putArtifactEverywhere(customBlockKey(block.projectId!, block.id), artifact);
	await logCompiled(resource);
	logger.info(`[compiler] compiled custom block ${block.name}`, "COMPILER");
}

export async function dropCustomBlock(projectId: string, id: string) {
	unregisterLocally(id);
	await deleteArtifactEverywhere(customBlockKey(projectId, id));
}

/** app config and integrations are global caches, so a change touches everyone */
export async function publishAllProjectConfigs() {
	const projects = await db.select({ id: projectsEntity.id }).from(projectsEntity);
	for (const project of projects) await publishProjectConfig(project.id);
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
		.where(eq(parentColumn(edgesEntity, parent.type), parent.id));

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
