import { compileGraph } from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { deleteArtifact, putArtifact } from "../../db/natsKv";
import { projectsEntity, sandboxesEntity } from "../../db/schema";
import { CONTENT_TYPES } from "../../lib/routeConfig";
import { compileDependencies } from "../packages/service";
import type { RouteArtifact, WorkflowArtifact } from "./artifacts";
import {
	type CompiledResource,
	compileOrThrow,
	ensureCustomBlocksRegistered,
	loadGraph,
	logCompiled,
	recordFailure,
} from "./service";
import { sandboxKey, sandboxWorkflowKey } from "./subjects";

/**
 * A sandbox (#735) is one graph compiled twice, as a route and as a workflow,
 * the same way a route and a workflow differ: only `asWorkflow`. Both go to the
 * development bucket and nowhere else, so a production worker never holds one.
 * Both always record; tracing is the owner's setting.
 */
export async function compileSandbox(sandboxId: string) {
	const [sandbox] = await db
		.select({
			name: sandboxesEntity.name,
			projectId: sandboxesEntity.projectId,
			projectName: projectsEntity.name,
			settings: sandboxesEntity.settings,
		})
		.from(sandboxesEntity)
		.leftJoin(projectsEntity, eq(sandboxesEntity.projectId, projectsEntity.id))
		.where(eq(sandboxesEntity.id, sandboxId));
	// deleted: the delete itself dropped the artifacts, while it still knew the project
	if (!sandbox) return;

	const { projectId } = sandbox;
	const resource: CompiledResource = { projectId, resourceType: "sandbox", resourceId: sandboxId };
	await ensureCustomBlocksRegistered(projectId);
	const { blocks, edges } = await loadGraph({ type: "sandbox", id: sandboxId });
	// recording is always on, so the spans are always compiled in
	const options = { projectId, dependencies: await compileDependencies(projectId), tracing: true };
	let route: string;
	let workflow: string;
	try {
		route = compileOrThrow(resource, () => compileGraph(blocks, edges, options)).source;
		workflow = compileOrThrow(resource, () =>
			compileGraph(blocks, edges, { ...options, asWorkflow: true }),
		).source;
	} catch (error) {
		return recordFailure(error);
	}

	const compiledAt = new Date().toISOString();
	const shared = {
		projectId,
		projectName: sandbox.projectName ?? "",
		tracingEnabled: sandbox.settings.tracingEnabled,
		recordExecution: true,
		sandbox: true as const,
		compiledAt,
	};
	await Promise.all([
		putArtifact(
			sandboxKey(projectId, sandboxId),
			{
				...shared,
				routeId: sandboxId,
				method: "*",
				path: `/_sandbox/${sandboxId}`,
				timeoutSeconds: 30,
				// any body: nothing about a sandbox request is declared up front
				acceptedContentTypes: [...CONTENT_TYPES],
				routeVersion: compiledAt,
				source: route,
			} satisfies RouteArtifact,
			"development",
		),
		putArtifact(
			sandboxWorkflowKey(projectId, sandboxId),
			{
				...shared,
				workflowId: sandboxId,
				name: sandbox.name,
				timeoutSeconds: 300,
				workflowVersion: compiledAt,
				source: workflow,
			} satisfies WorkflowArtifact,
			"development",
		),
	]);
	await logCompiled(resource);
	logger.info(`[compiler] compiled sandbox ${sandbox.name}`, "COMPILER");
}

export async function dropSandbox(projectId: string, sandboxId: string) {
	await Promise.all([
		deleteArtifact(sandboxKey(projectId, sandboxId), "development"),
		deleteArtifact(sandboxWorkflowKey(projectId, sandboxId), "development"),
	]);
}

export async function compileProjectSandboxes(projectId: string) {
	const rows = await db
		.select({ id: sandboxesEntity.id })
		.from(sandboxesEntity)
		.where(eq(sandboxesEntity.projectId, projectId));
	for (const row of rows) await compileSandbox(row.id);
	return rows.length;
}
