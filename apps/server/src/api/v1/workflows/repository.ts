import { and, count, desc, eq, ilike, SQL } from "drizzle-orm";
import { BlockTypes } from "@fluxify/blocks";
import { generateID } from "@fluxify/lib";
import { db, DbTransactionType } from "../../../db";
import {
	blocksEntity,
	projectsEntity,
	workflowsEntity,
} from "../../../db/schema";

type WorkflowInsert = typeof workflowsEntity.$inferInsert;

export async function insertWorkflow(
	data: WorkflowInsert,
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.insert(workflowsEntity)
		.values(data)
		.returning({ id: workflowsEntity.id });
	return row!.id;
}

/**
 * The two blocks every canvas must have exactly one of. A workflow gets no
 * `response` block — nothing is waiting on an answer.
 */
export async function seedDefaultBlocks(
	workflowId: string,
	tx?: DbTransactionType,
) {
	await (tx ?? db).insert(blocksEntity).values([
		{
			id: generateID(),
			workflowId,
			type: BlockTypes.entrypoint,
			position: { x: 0, y: 0 },
			data: {},
		},
		{
			id: generateID(),
			workflowId,
			type: BlockTypes.errorHandler,
			// a block is ~168px wide; less than that overlaps the entrypoint
			position: { x: -240, y: 0 },
			data: { next: "", retryAfterFail: false, retryCount: 0 },
		},
	]);
}

export async function findWorkflowById(id: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select()
		.from(workflowsEntity)
		.where(eq(workflowsEntity.id, id))
		.limit(1);
	return row;
}

/** A name is unique within its project — the portal lists workflows by it. */
export async function findWorkflowByName(
	projectId: string,
	name: string,
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.select({ id: workflowsEntity.id })
		.from(workflowsEntity)
		.where(
			and(
				eq(workflowsEntity.projectId, projectId),
				ilike(workflowsEntity.name, name),
			),
		)
		.limit(1);
	return row;
}

export async function updateWorkflowRow(
	id: string,
	data: Partial<WorkflowInsert>,
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.update(workflowsEntity)
		.set(data)
		.where(eq(workflowsEntity.id, id))
		.returning();
	return row;
}

export async function deleteWorkflowRow(id: string, tx?: DbTransactionType) {
	await (tx ?? db).delete(workflowsEntity).where(eq(workflowsEntity.id, id));
}

export async function projectExists(id: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select({ id: projectsEntity.id })
		.from(projectsEntity)
		.where(eq(projectsEntity.id, id))
		.limit(1);
	return !!row;
}

export async function listWorkflows(
	skip: number,
	limit: number,
	filter?: SQL<unknown>,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
		.select({
			id: workflowsEntity.id,
			name: workflowsEntity.name,
			description: workflowsEntity.description,
			active: workflowsEntity.active,
			payloadSchema: workflowsEntity.payloadSchema,
			timeoutSeconds: workflowsEntity.timeoutSeconds,
			tracingEnabled: workflowsEntity.tracingEnabled,
			recordExecution: workflowsEntity.recordExecution,
			projectId: workflowsEntity.projectId,
			projectName: projectsEntity.name,
			createdAt: workflowsEntity.createdAt,
			updatedAt: workflowsEntity.updatedAt,
		})
		.from(workflowsEntity)
		.leftJoin(projectsEntity, eq(workflowsEntity.projectId, projectsEntity.id))
		.where(filter)
		.orderBy(desc(workflowsEntity.updatedAt))
		.offset(skip)
		.limit(limit);

	const [total] = await (tx ?? db)
		.select({ count: count(workflowsEntity.id) })
		.from(workflowsEntity)
		.where(filter);

	return { result, totalCount: total!.count };
}
