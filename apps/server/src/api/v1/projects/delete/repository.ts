import { eq, inArray } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../../db";
import {
	customBlocksListEntity,
	middlewareBlocksEntity,
	middlewaresEntity,
	projectsEntity,
	routesEntity,
	sandboxesEntity,
	triggersEntity,
	workflowsEntity,
} from "../../../../db/schema";

export async function findProjectById(id: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select({ id: projectsEntity.id, name: projectsEntity.name, slug: projectsEntity.slug })
		.from(projectsEntity)
		.where(eq(projectsEntity.id, id));
	return row;
}

/**
 * What the project owns that the database cascade cannot withdraw: each row's
 * id, read before the project goes, because its broker artifact is keyed by it.
 */
export async function findProjectContents(projectId: string, tx?: DbTransactionType) {
	const conn = tx ?? db;
	const triggers = await conn
		.select({ id: triggersEntity.id, type: triggersEntity.type })
		.from(triggersEntity)
		.where(eq(triggersEntity.projectId, projectId));
	const routes = await conn
		.select({ id: routesEntity.id })
		.from(routesEntity)
		.where(eq(routesEntity.projectId, projectId));
	const workflows = await conn
		.select({ id: workflowsEntity.id })
		.from(workflowsEntity)
		.where(eq(workflowsEntity.projectId, projectId));
	const middlewares = await conn
		.select({ id: middlewaresEntity.id })
		.from(middlewaresEntity)
		.where(eq(middlewaresEntity.projectId, projectId));
	const customBlocks = await conn
		.select({ id: customBlocksListEntity.id })
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.projectId, projectId));
	const sandboxes = await conn
		.select({ id: sandboxesEntity.id })
		.from(sandboxesEntity)
		.where(eq(sandboxesEntity.projectId, projectId));
	return {
		triggers,
		routes: routes.map((r) => r.id),
		workflows: workflows.map((w) => w.id),
		middlewares: middlewares.map((m) => m.id),
		customBlocks: customBlocks.map((b) => b.id),
		sandboxes: sandboxes.map((s) => s.id),
	};
}

/**
 * The cascade cannot remove these: a middleware chain's block and a trigger's
 * group are RESTRICT foreign keys, so the rows holding them go first.
 */
export async function clearRestrictedRows(projectId: string, tx?: DbTransactionType) {
	const conn = tx ?? db;
	await conn.delete(triggersEntity).where(eq(triggersEntity.projectId, projectId));
	await conn
		.delete(middlewareBlocksEntity)
		.where(
			inArray(
				middlewareBlocksEntity.middlewareId,
				conn
					.select({ id: middlewaresEntity.id })
					.from(middlewaresEntity)
					.where(eq(middlewaresEntity.projectId, projectId)),
			),
		);
}

export async function deleteProjectRow(id: string, tx?: DbTransactionType) {
	await (tx ?? db).delete(projectsEntity).where(eq(projectsEntity.id, id));
}
