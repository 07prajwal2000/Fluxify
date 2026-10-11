import { BlockTypes } from "@fluxify/blocks";
import { STARTER_POSITIONS } from "@fluxify/blocks/layout";
import { generateID } from "@fluxify/lib";
import { and, count, desc, eq, ilike, type SQL, sql } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../db";
import { blocksEntity, projectsEntity, workflowsEntity } from "../../../db/schema";
import { parentKeys, reserveBlockKeys } from "../../../modules/canvas/repository";
import {
	versionedSettingsChanged,
	WORKFLOW_VERSIONED_FIELDS,
} from "../../../modules/versions/state";

type WorkflowInsert = typeof workflowsEntity.$inferInsert;

export async function insertWorkflow(data: WorkflowInsert, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.insert(workflowsEntity)
		.values(data)
		.returning({ id: workflowsEntity.id });
	return row!.id;
}

/**
 * The two blocks every canvas must have exactly one of. A workflow gets no
 * `response` block — nothing is waiting on an answer. A sandbox (#735) starts
 * the same way.
 */
export async function seedDefaultBlocks(
	id: string,
	tx?: DbTransactionType,
	type: "workflow" | "sandbox" = "workflow",
) {
	const parent = { type, id };
	const [entryKey, errorKey] = await reserveBlockKeys(
		parent,
		[BlockTypes.entrypoint, BlockTypes.errorHandler],
		tx,
	);
	await (tx ?? db).insert(blocksEntity).values([
		{
			id: generateID(),
			key: entryKey,
			...parentKeys(parent),
			type: BlockTypes.entrypoint,
			position: STARTER_POSITIONS.entrypoint,
			data: {},
		},
		{
			id: generateID(),
			key: errorKey,
			...parentKeys(parent),
			type: BlockTypes.errorHandler,
			position: STARTER_POSITIONS.errorHandler,
			data: {},
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
export async function findWorkflowByName(projectId: string, name: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select({ id: workflowsEntity.id })
		.from(workflowsEntity)
		.where(and(eq(workflowsEntity.projectId, projectId), ilike(workflowsEntity.name, name)))
		.limit(1);
	return row;
}

/** A changed timeout moves the revision (#738), as it does for a route. */
export async function updateWorkflowRow(
	id: string,
	patch: Partial<WorkflowInsert>,
	tx?: DbTransactionType,
) {
	// commit, checkout and promote own these; a patch never moves them
	const {
		canvasRevision: _revision,
		blockKeyCounters: _keys,
		committedRevision: _committed,
		headVersionId: _head,
		prodVersionId: _prod,
		...data
	} = patch;
	const conn = tx ?? db;
	const [stored] = await conn
		.select()
		.from(workflowsEntity)
		.where(eq(workflowsEntity.id, id))
		.for("update");
	const bump = !!stored && versionedSettingsChanged(stored, data, WORKFLOW_VERSIONED_FIELDS);
	const [row] = await conn
		.update(workflowsEntity)
		.set(bump ? { ...data, canvasRevision: sql`${workflowsEntity.canvasRevision} + 1` } : data)
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
			devActive: workflowsEntity.devActive,
			timeoutSeconds: workflowsEntity.timeoutSeconds,
			tracingEnabled: workflowsEntity.tracingEnabled,
			recordExecution: workflowsEntity.recordExecution,
			devTracingEnabled: workflowsEntity.devTracingEnabled,
			devRecordExecution: workflowsEntity.devRecordExecution,
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
