import { and, count, desc, eq, ilike, SQL } from "drizzle-orm";
import { generateID } from "@fluxify/lib";
import { db, DbTransactionType } from "../../../db";
import {
	projectsEntity,
	triggerGroupsEntity,
	triggersEntity,
	workflowsEntity,
} from "../../../db/schema";

type TriggerInsert = typeof triggersEntity.$inferInsert;

export const DEFAULT_GROUP_NAME = "default";

/**
 * The project's default group, created on first use.
 *
 * Resolved lazily rather than seeded when the project is created: that way
 * projects that predate triggers get one too, without a backfill migration that
 * would have to invent ids in SQL.
 */
export async function ensureDefaultGroup(
	projectId: string,
	userId?: string,
	tx?: DbTransactionType,
) {
	const runner = tx ?? db;
	const [existing] = await runner
		.select({ id: triggerGroupsEntity.id })
		.from(triggerGroupsEntity)
		.where(
			and(
				eq(triggerGroupsEntity.projectId, projectId),
				eq(triggerGroupsEntity.isDefault, true),
			),
		)
		.limit(1);
	if (existing) return existing.id;

	const [row] = await runner
		.insert(triggerGroupsEntity)
		.values({
			id: generateID(),
			name: DEFAULT_GROUP_NAME,
			description: "Triggers with no group of their own run here.",
			projectId,
			isDefault: true,
			createdBy: userId,
		})
		.returning({ id: triggerGroupsEntity.id });
	return row!.id;
}

export async function listGroups(projectId: string, tx?: DbTransactionType) {
	return (tx ?? db)
		.select()
		.from(triggerGroupsEntity)
		.where(eq(triggerGroupsEntity.projectId, projectId))
		.orderBy(desc(triggerGroupsEntity.isDefault), triggerGroupsEntity.name);
}

export async function findGroupById(id: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select()
		.from(triggerGroupsEntity)
		.where(eq(triggerGroupsEntity.id, id))
		.limit(1);
	return row;
}

export async function insertGroup(
	data: typeof triggerGroupsEntity.$inferInsert,
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.insert(triggerGroupsEntity)
		.values(data)
		.returning({ id: triggerGroupsEntity.id });
	return row!.id;
}

export async function deleteGroupRow(id: string, tx?: DbTransactionType) {
	await (tx ?? db).delete(triggerGroupsEntity).where(eq(triggerGroupsEntity.id, id));
}

/* ---------------------------------------------------------------- triggers */

export async function insertTrigger(data: TriggerInsert, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.insert(triggersEntity)
		.values(data)
		.returning({ id: triggersEntity.id });
	return row!.id;
}

export async function findTriggerById(id: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select()
		.from(triggersEntity)
		.where(eq(triggersEntity.id, id))
		.limit(1);
	return row;
}

/** A name is unique within its project — the settings panel lists triggers by it. */
export async function findTriggerByName(
	projectId: string,
	name: string,
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.select({ id: triggersEntity.id })
		.from(triggersEntity)
		.where(
			and(eq(triggersEntity.projectId, projectId), ilike(triggersEntity.name, name)),
		)
		.limit(1);
	return row;
}

export async function updateTriggerRow(
	id: string,
	data: Partial<TriggerInsert>,
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.update(triggersEntity)
		.set(data)
		.where(eq(triggersEntity.id, id))
		.returning();
	return row;
}

export async function deleteTriggerRow(id: string, tx?: DbTransactionType) {
	await (tx ?? db).delete(triggersEntity).where(eq(triggersEntity.id, id));
}

export async function findWorkflow(id: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select({ id: workflowsEntity.id, projectId: workflowsEntity.projectId })
		.from(workflowsEntity)
		.where(eq(workflowsEntity.id, id))
		.limit(1);
	return row;
}

export async function projectExists(id: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select({ id: projectsEntity.id })
		.from(projectsEntity)
		.where(eq(projectsEntity.id, id))
		.limit(1);
	return !!row;
}

export async function listTriggers(
	skip: number,
	limit: number,
	filter?: SQL<unknown>,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
		.select({
			id: triggersEntity.id,
			name: triggersEntity.name,
			description: triggersEntity.description,
			type: triggersEntity.type,
			projectId: triggersEntity.projectId,
			workflowId: triggersEntity.workflowId,
			workflowName: workflowsEntity.name,
			groupId: triggersEntity.groupId,
			integrationId: triggersEntity.integrationId,
			batchSize: triggersEntity.batchSize,
			maxWaitMs: triggersEntity.maxWaitMs,
			maxBytes: triggersEntity.maxBytes,
			concurrency: triggersEntity.concurrency,
			payload: triggersEntity.payload,
			active: triggersEntity.active,
			createdAt: triggersEntity.createdAt,
			updatedAt: triggersEntity.updatedAt,
		})
		.from(triggersEntity)
		.leftJoin(workflowsEntity, eq(triggersEntity.workflowId, workflowsEntity.id))
		.where(filter)
		.orderBy(desc(triggersEntity.updatedAt))
		.offset(skip)
		.limit(limit);

	const [total] = await (tx ?? db)
		.select({ count: count(triggersEntity.id) })
		.from(triggersEntity)
		.where(filter);

	return { result, totalCount: total!.count };
}

/** Every active trigger in a project, for republishing the artifact set. */
export async function listActiveTriggers(projectId: string, tx?: DbTransactionType) {
	return (tx ?? db)
		.select()
		.from(triggersEntity)
		.where(
			and(eq(triggersEntity.projectId, projectId), eq(triggersEntity.active, true)),
		);
}
