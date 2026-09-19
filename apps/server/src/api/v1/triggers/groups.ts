import { generateID } from "@fluxify/lib";
import type { z } from "zod";
import { db } from "../../../db";
import type { AuthACL } from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { ConflictError } from "../../../errors/conflictError";
import { ForbiddenError } from "../../../errors/forbidError";
import { NotFoundError } from "../../../errors/notFoundError";
import { canAccessProject } from "../../../lib/acl";
import { recordGroupRemoval, removeGroupFromClaims } from "../../../modules/orchestrator/claims";
import { removeSchedule } from "../../../modules/schedules/reconciler";
import type {
	createGroupSchema,
	deleteGroupQuerySchema,
	groupSchema,
	updateGroupSchema,
} from "./dto";
import {
	deleteGroupRow,
	deleteGroupTriggers,
	ensureDefaultGroup,
	findGroupById,
	insertGroup,
	listGroups,
	moveGroupTriggers,
	updateGroupRow,
} from "./repository";
import { assertGroupInProject, republish, withdraw } from "./service";

/**
 * Trigger groups: where a trigger runs. A worker node serves the groups its
 * claim names, so deleting a group also has to take it off those claims.
 */

export async function listTriggerGroups(
	projectId: string,
	acl: AuthACL[] = [],
): Promise<{ data: z.infer<typeof groupSchema>[] }> {
	if (!canAccessProject(acl, projectId, "viewer")) throw new ForbiddenError();
	// Creating it on a read looks odd, but a project with no group has nothing to
	// offer the trigger form, and the alternative is every caller handling an
	// empty list that only ever means "not created yet".
	await ensureDefaultGroup(projectId);
	const rows = await listGroups(projectId);
	return { data: rows.map(presentGroup) };
}

export async function createTriggerGroup(
	userId: string,
	data: z.infer<typeof createGroupSchema>,
	acl: AuthACL[] = [],
) {
	if (!canAccessProject(acl, data.projectId, "creator")) throw new ForbiddenError();
	await assertGroupNameFree(data.projectId, data.name);
	const id = await insertGroup({
		id: generateID(),
		name: data.name,
		description: data.description,
		projectId: data.projectId,
		isDefault: false,
		createdBy: userId,
	});
	return { id };
}

/** Renaming is safe: everything downstream keys on the group's id, never its name. */
export async function updateTriggerGroup(
	id: string,
	data: z.infer<typeof updateGroupSchema>,
	acl: AuthACL[] = [],
) {
	const group = await findGroupById(id);
	if (!group) throw new NotFoundError("Trigger group not found");
	if (!canAccessProject(acl, group.projectId, "creator")) throw new ForbiddenError();
	if (group.isDefault) throw new BadRequestError("The default group cannot be edited");
	if (data.name && data.name !== group.name) await assertGroupNameFree(group.projectId, data.name);
	await updateGroupRow(id, data);
	return { id };
}

/**
 * Deleting a group. Its triggers are moved or deleted first, as the caller
 * chose; with no choice, a group that still has triggers is refused. Every
 * claim naming the group loses it in the same transaction, and a claim left
 * with no group is scaled to zero so its nodes drain rather than idle.
 */
export async function deleteTriggerGroup(
	id: string,
	options: z.infer<typeof deleteGroupQuerySchema>,
	acl: AuthACL[] = [],
) {
	const group = await findGroupById(id);
	if (!group) throw new NotFoundError("Trigger group not found");
	if (!canAccessProject(acl, group.projectId, "creator")) throw new ForbiddenError();
	// The default is where an ungrouped trigger lands. Without it, creating a
	// trigger has nowhere to put it.
	if (group.isDefault) throw new BadRequestError("The default group cannot be deleted");
	if (options.triggers === "move" && options.moveTo === id)
		throw new BadRequestError("Move the triggers to a different group");

	const { moved, deleted, removals } = await db.transaction(async (tx) => {
		const moved =
			options.triggers === "move"
				? await moveGroupTriggers(
						id,
						await assertGroupInProject(options.moveTo!, group.projectId, tx),
						tx,
					)
				: [];
		const deleted = options.triggers === "delete" ? await deleteGroupTriggers(id, tx) : [];
		const removals = await removeGroupFromClaims(id, tx);
		// The foreign key restricts this, but the error it raises says nothing a
		// user could act on.
		await deleteGroupRow(id, tx).catch(() => {
			throw new ConflictError("Move or delete this group's triggers first");
		});
		return { moved, deleted, removals };
	});

	// Same order as a single trigger's write: the row first, then the artifact.
	for (const trigger of moved) await republish(trigger);
	for (const trigger of deleted)
		if (trigger.type === "schedule") await removeSchedule(trigger.projectId, trigger.id);
		else await withdraw(trigger.projectId, trigger.id);
	await recordGroupRemoval(removals, group);

	return { id, drainedClaims: removals.filter((removal) => removal.drained).length };
}

function presentGroup(
	row: Awaited<ReturnType<typeof listGroups>>[number],
): z.infer<typeof groupSchema> {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		projectId: row.projectId,
		isDefault: row.isDefault,
		triggerCount: row.triggerCount,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/** The unique index would refuse it too, but as a 500 nobody could act on. */
async function assertGroupNameFree(projectId: string, name: string) {
	const groups = await listGroups(projectId);
	if (groups.some((group) => group.name === name))
		throw new ConflictError("A trigger group with that name already exists");
}
