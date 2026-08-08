import { compileGraph } from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
	customBlocksListEntity,
	projectsEntity,
	routesEntity,
} from "../../db/schema";
import { loadGraph } from "../compiler/service";

/**
 * The compiled graph a suite runs, built from the database on every run.
 *
 * Deliberately not read from the artifact store: that holds the last published
 * compile, so editing a route and pressing Run would test the previously
 * deployed version. A suite tests what is saved.
 */
export async function compileSuiteRoute(routeId: string) {
	const [route] = await db
		.select({
			id: routesEntity.id,
			method: routesEntity.method,
			path: routesEntity.path,
			projectId: routesEntity.projectId,
			projectName: projectsEntity.name,
			bodySchema: routesEntity.bodySchema,
			querySchema: routesEntity.querySchema,
			paramsSchema: routesEntity.paramsSchema,
			timeoutSeconds: routesEntity.timeoutSeconds,
		})
		.from(routesEntity)
		.leftJoin(projectsEntity, eq(routesEntity.projectId, projectsEntity.id))
		.where(eq(routesEntity.id, routeId));

	if (!route) throw new Error(`Route ${routeId} not found`);

	const { blocks, edges } = await loadGraph({ type: "route", id: routeId });
	const { source } = compileGraph(blocks, edges);
	return {
		route,
		source,
		customBlocks: await compileProjectCustomBlocks(route.projectId!),
	};
}

/**
 * Every custom block in the project, compiled and ready to register.
 *
 * A route that calls one only runs if the library holds it, and the child has no
 * database to fetch a missing one from.
 *
 * ponytail: compiles the whole project rather than just the blocks this route
 * reaches. Walk the graph for invocations if a large project makes a run slow.
 */
async function compileProjectCustomBlocks(projectId: string) {
	const rows = await db
		.select({ id: customBlocksListEntity.id, name: customBlocksListEntity.name })
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.projectId, projectId));

	const compiled: Array<{ name: string; source: string }> = [];
	for (const row of rows) {
		try {
			const { blocks, edges } = await loadGraph({
				type: "custom_block",
				id: row.id,
			});
			// `param:` placeholders resolve from the invocation, same as the compiler
			const { source } = compileGraph(blocks, edges, { asCustomBlock: true });
			compiled.push({ name: row.name, source });
		} catch (error) {
			// one unfinished block must not stop the suite; the route only fails if
			// it actually calls this one, and then it fails with a clear message
			logger.error(
				`[test-runner] skipping custom block ${row.name}: ${String(error)}`,
				"TEST_RUNNER",
			);
		}
	}
	return compiled;
}
