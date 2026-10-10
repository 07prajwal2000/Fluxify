import { logger } from "@fluxify/common";
import { db } from "../../db";
import { projectsEntity } from "../../db/schema";
import { compileProjectSandboxes } from "./sandbox";
import {
	compileProjectCustomBlocks,
	compileProjectMiddlewares,
	compileProjectRoutes,
	compileProjectWorkflows,
	publishProjectConfig,
} from "./service";

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
	await compileProjectMiddlewares(projectId);
	const routes = await compileProjectRoutes(projectId);
	const workflows = await compileProjectWorkflows(projectId);
	const sandboxes = await compileProjectSandboxes(projectId);
	logger.info(
		`[compiler] project ${projectId}: ${routes} routes, ${workflows} workflows, ${sandboxes} sandboxes, ${blocks} custom blocks`,
		"COMPILER",
	);
}
