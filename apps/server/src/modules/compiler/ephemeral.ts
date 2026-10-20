import type { BlockDTOType, EdgeDTOSchemaType } from "@fluxify/blocks";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { deleteArtifact, putArtifact } from "../../db/natsKv";
import { projectsEntity } from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { CONTENT_TYPES } from "../../lib/routeConfig";
import { compileDependencies } from "../packages/service";
import { artifactBuild, compileWithPlugins, loadPluginSets } from "../plugins/compile";
import type { RouteArtifact } from "./artifacts";
import { ensureCustomBlocksRegistered } from "./service";
import { sandboxKey } from "./subjects";

/**
 * An ephemeral run (#741) is a sandbox that never was one: the graph is compiled
 * in memory, lives in the development bucket under a sandbox-shaped key for one
 * call, and is deleted again. No row anywhere, so nothing recompiles it and a
 * production worker never holds it.
 */
export const newEphemeralId = () => `eph_${crypto.randomUUID().replaceAll("-", "")}`;

export async function compileEphemeral(o: {
	projectId: string;
	id: string;
	blocks: BlockDTOType[];
	edges: EdgeDTOSchemaType;
	timeoutSeconds: number;
}): Promise<RouteArtifact> {
	const { projectId, id } = o;
	const [project] = await db
		.select({ name: projectsEntity.name })
		.from(projectsEntity)
		.where(eq(projectsEntity.id, projectId));
	await ensureCustomBlocksRegistered(projectId);
	const dependencies = await compileDependencies(projectId);
	const plugins = (await loadPluginSets(projectId)).development;
	let built: ReturnType<typeof artifactBuild>;
	try {
		built = artifactBuild(
			// spans are built so the call can answer with the trace; nothing is stored
			compileWithPlugins(o.blocks, o.edges, { projectId, dependencies, tracing: true }, plugins),
		);
	} catch (error) {
		// the same graph would fail again: the caller's to fix, not a retry
		throw new BadRequestError(
			`The graph does not compile: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const compiledAt = new Date().toISOString();
	return {
		projectId,
		projectName: project?.name ?? "",
		routeId: id,
		method: "*",
		path: `/_sandbox/${id}`,
		timeoutSeconds: o.timeoutSeconds,
		acceptedContentTypes: [...CONTENT_TYPES],
		tracingEnabled: false,
		recordExecution: false,
		routeVersion: compiledAt,
		compiledAt,
		...built,
		sandbox: true,
		ephemeral: true,
	};
}

export const publishEphemeral = (artifact: RouteArtifact) =>
	putArtifact(sandboxKey(artifact.projectId, artifact.routeId), artifact, "development");

export const dropEphemeral = (projectId: string, id: string) =>
	deleteArtifact(sandboxKey(projectId, id), "development");
