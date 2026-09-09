import { and, count, desc, eq, ilike, inArray, isNotNull, SQL } from "drizzle-orm";
import { generateID } from "@fluxify/lib";
import { db, DbTransactionType } from "../../../db";
import {
	projectsEntity,
	triggerGroupsEntity,
	triggerWorkflowsEntity,
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
			groupId: triggersEntity.groupId,
			integrationId: triggersEntity.integrationId,
			batchSize: triggersEntity.batchSize,
			maxWaitMs: triggersEntity.maxWaitMs,
			maxBytes: triggersEntity.maxBytes,
			concurrency: triggersEntity.concurrency,
			payload: triggersEntity.payload,
			schedule: triggersEntity.schedule,
			timezone: triggersEntity.timezone,
			active: triggersEntity.active,
			createdAt: triggersEntity.createdAt,
			updatedAt: triggersEntity.updatedAt,
		})
		.from(triggersEntity)
		.where(filter)
		.orderBy(desc(triggersEntity.createdAt))
		.offset(skip)
		.limit(limit);

	const [total] = await (tx ?? db)
		.select({ count: count(triggersEntity.id) })
		.from(triggersEntity)
		.where(filter);

	return { result, totalCount: total!.count };
}

/**
 * Every scheduled trigger that should be firing, across every project.
 *
 * Not project-scoped like the query above it: the reconciler's job is to decide
 * what the broker should hold in total, and a per-project view cannot tell an
 * orphan from a schedule belonging to a project it was not asked about.
 */
export async function listActiveScheduledTriggers(tx?: DbTransactionType) {
	const rows = await (tx ?? db)
		.select({
			id: triggersEntity.id,
			projectId: triggersEntity.projectId,
			schedule: triggersEntity.schedule,
			timezone: triggersEntity.timezone,
			payload: triggersEntity.payload,
		})
		.from(triggersEntity)
		.where(
			and(
				eq(triggersEntity.type, "schedule"),
				eq(triggersEntity.active, true),
				isNotNull(triggersEntity.schedule),
			),
		);

	const links = await workflowsForTriggers(
		rows.map((row) => row.id),
		tx,
	);
	return rows.map((row) => ({
		...row,
		workflowIds: (links.get(row.id) ?? []).map((workflow) => workflow.id),
	}));
}

/* ----------------------------------------------------------------- links */

/** The workflows one trigger starts, ordered so a comparison of two reads is stable. */
export async function workflowIdsFor(triggerId: string, tx?: DbTransactionType) {
	const rows = await (tx ?? db)
		.select({ workflowId: triggerWorkflowsEntity.workflowId })
		.from(triggerWorkflowsEntity)
		.where(eq(triggerWorkflowsEntity.triggerId, triggerId))
		.orderBy(triggerWorkflowsEntity.workflowId);
	return rows.map((row) => row.workflowId);
}

/**
 * The linked workflows for a page of triggers, in one query.
 *
 * Names come along because every list that shows a trigger shows what it
 * starts, and asking for them per row is how a 50-row page becomes 51 queries.
 */
export async function workflowsForTriggers(
	triggerIds: string[],
	tx?: DbTransactionType,
) {
	const byTrigger = new Map<string, { id: string; name: string }[]>();
	if (triggerIds.length === 0) return byTrigger;

	const rows = await (tx ?? db)
		.select({
			triggerId: triggerWorkflowsEntity.triggerId,
			id: workflowsEntity.id,
			name: workflowsEntity.name,
		})
		.from(triggerWorkflowsEntity)
		.innerJoin(
			workflowsEntity,
			eq(triggerWorkflowsEntity.workflowId, workflowsEntity.id),
		)
		.where(inArray(triggerWorkflowsEntity.triggerId, triggerIds))
		.orderBy(workflowsEntity.name);

	for (const row of rows) {
		const list = byTrigger.get(row.triggerId) ?? [];
		list.push({ id: row.id, name: row.name ?? "" });
		byTrigger.set(row.triggerId, list);
	}
	return byTrigger;
}

/** Replaces a trigger's links wholesale. Delete-then-insert, inside the caller's transaction. */
export async function setWorkflowLinks(
	triggerId: string,
	workflowIds: string[],
	tx?: DbTransactionType,
) {
	const runner = tx ?? db;
	await runner
		.delete(triggerWorkflowsEntity)
		.where(eq(triggerWorkflowsEntity.triggerId, triggerId));
	if (workflowIds.length === 0) return;
	await runner
		.insert(triggerWorkflowsEntity)
		.values(workflowIds.map((workflowId) => ({ triggerId, workflowId })));
}

/** Links one workflow. Already linked is success, not a conflict — the end state is what was asked for. */
export async function linkWorkflow(
	triggerId: string,
	workflowId: string,
	tx?: DbTransactionType,
) {
	await (tx ?? db)
		.insert(triggerWorkflowsEntity)
		.values({ triggerId, workflowId })
		.onConflictDoNothing();
}

export async function unlinkWorkflow(
	triggerId: string,
	workflowId: string,
	tx?: DbTransactionType,
) {
	await (tx ?? db)
		.delete(triggerWorkflowsEntity)
		.where(
			and(
				eq(triggerWorkflowsEntity.triggerId, triggerId),
				eq(triggerWorkflowsEntity.workflowId, workflowId),
			),
		);
}

/** Trigger ids linked to a workflow, for filtering a list by it. */
export function triggerIdsForWorkflow(workflowId: string) {
	return db
		.select({ id: triggerWorkflowsEntity.triggerId })
		.from(triggerWorkflowsEntity)
		.where(eq(triggerWorkflowsEntity.workflowId, workflowId));
}
