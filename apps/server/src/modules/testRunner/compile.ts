import { BlockTypes, compileGraph } from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
	customBlocksListEntity,
	projectsEntity,
	routesEntity,
	workflowsEntity,
} from "../../db/schema";
import { loadGraph } from "../compiler/service";
import { compileDependencies } from "../packages/service";
import type { SuiteTarget } from "./target";

type Dependencies = Awaited<ReturnType<typeof compileDependencies>>;

/** a route or a workflow, compiled with hook points, plus the project's custom blocks */
export type CompiledSuiteTarget = Awaited<
	ReturnType<typeof compileSuiteRoute | typeof compileSuiteWorkflow>
>;

export function compileSuiteTarget(target: SuiteTarget): Promise<CompiledSuiteTarget> {
	return target.type === "route" ? compileSuiteRoute(target.id) : compileSuiteWorkflow(target.id);
}

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
	// package imports must resolve from the worker's installed deps, as live
	const dependencies = await compileDependencies(route.projectId!);
	// hook points in every block: a suite without hooks just finds none
	const { source } = compileGraph(blocks, edges, { dependencies, hooks: true });
	return {
		route,
		workflow: undefined,
		source,
		dependencies,
		customBlocks: await compileProjectCustomBlocks(route.projectId!, dependencies),
	};
}

/**
 * The same for a workflow (#487): compiled as the live worker compiles it
 * (`asWorkflow`), with hook points. Its trigger is not part of the graph, so a
 * suite runs the workflow with its input directly.
 */
export async function compileSuiteWorkflow(workflowId: string) {
	const [workflow] = await db
		.select({
			id: workflowsEntity.id,
			name: workflowsEntity.name,
			projectId: workflowsEntity.projectId,
			timeoutSeconds: workflowsEntity.timeoutSeconds,
		})
		.from(workflowsEntity)
		.where(eq(workflowsEntity.id, workflowId));
	if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

	const { blocks, edges } = await loadGraph({ type: "workflow", id: workflowId });
	const dependencies = await compileDependencies(workflow.projectId!);
	const { source } = compileGraph(blocks, edges, { asWorkflow: true, dependencies, hooks: true });
	return {
		route: undefined,
		workflow: { ...workflow, name: workflow.name ?? workflowId },
		source,
		dependencies,
		customBlocks: await compileProjectCustomBlocks(workflow.projectId!, dependencies),
	};
}

/** the name a suite's input script is registered under in its child */
export const INPUT_SCRIPT_BLOCK = "__suite_input__";

/**
 * A workflow suite's input script (#487), compiled as a one-block custom block:
 * it runs exactly like a JS block, so `import { faker } from "@faker-js/faker"`
 * resolves from the project's npm packages.
 */
export function compileInputScript(script: string, dependencies: Dependencies) {
	const blocks = [
		{ id: "entry", type: BlockTypes.entrypoint, position: { x: 0, y: 0 }, data: {} },
		{ id: "script", type: BlockTypes.jsrunner, position: { x: 0, y: 0 }, data: { value: script } },
	];
	const edges = [
		{ id: "e", from: "entry", to: "script", fromHandle: "source", toHandle: "source" },
	];
	return compileGraph(blocks, edges, { asCustomBlock: true, dependencies }).source;
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
async function compileProjectCustomBlocks(projectId: string, dependencies: Dependencies) {
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
			const { source } = compileGraph(blocks, edges, { asCustomBlock: true, dependencies });
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
