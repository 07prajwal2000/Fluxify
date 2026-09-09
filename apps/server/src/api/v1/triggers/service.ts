import { z } from "zod";
import { and, eq, ilike, inArray, SQL, sql } from "drizzle-orm";
import { logger } from "@fluxify/common";
import { generateID } from "@fluxify/lib";
import { db } from "../../../db";
import { AuthACL, triggersEntity } from "../../../db/schema";
import { canAccessProject } from "../../../lib/acl";
import { BadRequestError } from "../../../errors/badRequestError";
import { ConflictError } from "../../../errors/conflictError";
import { ForbiddenError } from "../../../errors/forbidError";
import { NotFoundError } from "../../../errors/notFoundError";
import { deleteArtifact, putArtifact } from "../../../db/natsKv";
import type { TriggerArtifact } from "../../../modules/compiler/artifacts";
import { triggerKey } from "../../../modules/compiler/subjects";
import {
	createGroupSchema,
	createSchema,
	groupSchema,
	listQuerySchema,
	listSchema,
	patchSchema,
	triggerSchema,
} from "./dto";
import {
	deleteGroupRow,
	deleteTriggerRow,
	ensureDefaultGroup,
	findGroupById,
	findTriggerById,
	findTriggerByName,
	findWorkflow,
	insertGroup,
	insertTrigger,
	listGroups,
	listTriggers,
	projectExists,
	updateTriggerRow,
} from "./repository";

/**
 * Trigger CRUD.
 *
 * Every write ends by republishing the trigger to the artifact store, which is
 * what starts or stops its consumer on whichever worker serves it. There is no
 * separate "reload triggers" signal: the artifact IS the signal, so a worker
 * that was restarting when the write happened still converges, and one that
 * never saw the row cannot be left consuming a trigger that no longer exists.
 */

type Trigger = Omit<typeof triggersEntity.$inferSelect, "createdBy">;

export async function createTrigger(
	userId: string,
	data: z.infer<typeof createSchema>,
	acl: AuthACL[] = [],
) {
	if (!canAccessProject(acl, data.projectId, "creator")) throw new ForbiddenError();
	assertSourceMatchesType(data.type, data.integrationId);

	const created = await db.transaction(async (tx) => {
		if (!(await projectExists(data.projectId, tx)))
			throw new NotFoundError(`project with id ${data.projectId} does not exist`);

		const workflow = await findWorkflow(data.workflowId, tx);
		if (!workflow) throw new NotFoundError("Workflow not found");
		// A trigger firing another project's workflow would be a tenant boundary
		// crossed by a dropdown, so it is refused here rather than at run time.
		if (workflow.projectId !== data.projectId)
			throw new BadRequestError("Workflow belongs to a different project");

		if (await findTriggerByName(data.projectId, data.name, tx))
			throw new ConflictError("trigger with that name already exists");

		const groupId = data.groupId
			? await assertGroupInProject(data.groupId, data.projectId, tx)
			: await ensureDefaultGroup(data.projectId, userId, tx);

		const id = await insertTrigger(
			{
				id: generateID(),
				name: data.name,
				description: data.description,
				type: data.type,
				projectId: data.projectId,
				workflowId: data.workflowId,
				groupId,
				integrationId: data.integrationId ?? null,
				batchSize: data.batchSize,
				maxWaitMs: data.maxWaitMs,
				maxBytes: data.maxBytes,
				concurrency: data.concurrency,
				payload: data.payload ?? null,
				active: data.active ?? false,
				createdBy: userId,
			},
			tx,
		);
		return (await findTriggerById(id, tx))!;
	});

	await republish(created);
	return { id: created.id };
}

export async function updateTrigger(
	id: string,
	data: z.infer<typeof patchSchema>,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof triggerSchema>> {
	const updated = await db.transaction(async (tx) => {
		const existing = await mustAccess(id, acl, "creator", tx);
		assertSourceMatchesType(
			existing.type,
			data.integrationId ?? existing.integrationId ?? undefined,
		);
		if (
			data.name &&
			data.name !== existing.name &&
			(await findTriggerByName(existing.projectId, data.name, tx))
		)
			throw new ConflictError("trigger with that name already exists");

		const groupId = data.groupId
			? await assertGroupInProject(data.groupId, existing.projectId, tx)
			: undefined;

		return (await updateTriggerRow(
			id,
			{
				...data,
				...(groupId ? { groupId } : {}),
				...(data.payload === undefined ? {} : { payload: data.payload }),
			},
			tx,
		))!;
	});

	await republish(updated);
	return present(updated);
}

export async function deleteTrigger(id: string, acl: AuthACL[] = []) {
	const existing = await db.transaction(async (tx) => {
		const trigger = await mustAccess(id, acl, "creator", tx);
		await deleteTriggerRow(id, tx);
		return trigger;
	});

	// Withdraw before returning: while the artifact is still there, a worker is
	// still holding a consumer for a trigger the database no longer knows about.
	await withdraw(existing.projectId, id);
	return { id };
}

export async function getTrigger(
	id: string,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof triggerSchema>> {
	return present(await mustAccess(id, acl, "viewer"));
}

export async function listAllTriggers(
	query: z.infer<typeof listQuerySchema>,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof listSchema>> {
	const offset = query.perPage * (query.page - 1);
	const isSystemAdmin = acl.some((a) => a.projectId === "*");
	const filters: (SQL | undefined)[] = [
		isSystemAdmin
			? undefined
			: inArray(
					triggersEntity.projectId,
					acl.map((a) => a.projectId),
				),
		query.projectId ? eq(triggersEntity.projectId, query.projectId) : undefined,
		query.workflowId ? eq(triggersEntity.workflowId, query.workflowId) : undefined,
		query.groupId ? eq(triggersEntity.groupId, query.groupId) : undefined,
		query.active === undefined ? undefined : eq(triggersEntity.active, query.active),
		query.search ? ilike(triggersEntity.name, `%${query.search}%`) : undefined,
	];
	const filter = and(...filters.filter(Boolean)) ?? sql`1=1`;

	const { result, totalCount } = await listTriggers(offset, query.perPage, filter);
	return {
		pagination: {
			page: query.page,
			totalPages: Math.ceil(totalCount / query.perPage),
			hasNext: offset + result.length < totalCount,
		},
		data: result.map((row) => ({
			...present(row as Trigger),
			workflowName: row.workflowName ?? "",
		})),
	};
}

/* ------------------------------------------------------------------ groups */

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
	return {
		data: rows.map((row) => ({
			id: row.id,
			name: row.name,
			description: row.description,
			projectId: row.projectId,
			isDefault: row.isDefault,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		})),
	};
}

export async function createTriggerGroup(
	userId: string,
	data: z.infer<typeof createGroupSchema>,
	acl: AuthACL[] = [],
) {
	if (!canAccessProject(acl, data.projectId, "creator")) throw new ForbiddenError();
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

export async function deleteTriggerGroup(id: string, acl: AuthACL[] = []) {
	const group = await findGroupById(id);
	if (!group) throw new NotFoundError("Trigger group not found");
	if (!canAccessProject(acl, group.projectId, "creator")) throw new ForbiddenError();
	// The default is where an ungrouped trigger lands. Without it, creating a
	// trigger has nowhere to put it.
	if (group.isDefault)
		throw new BadRequestError("The default group cannot be deleted");

	// The foreign key restricts this, but the error it raises says nothing a user
	// could act on.
	await deleteGroupRow(id).catch(() => {
		throw new ConflictError("Move or delete this group's triggers first");
	});
	return { id };
}

/* ----------------------------------------------------------------- helpers */

/** Loads a trigger and refuses the caller who may not touch it. */
export async function mustAccess(
	id: string,
	acl: AuthACL[],
	role: "viewer" | "creator",
	tx?: Parameters<typeof findTriggerById>[1],
) {
	const trigger = await findTriggerById(id, tx);
	if (!trigger) throw new NotFoundError("Trigger not found");
	if (!canAccessProject(acl, trigger.projectId, role)) throw new ForbiddenError();
	return trigger;
}

async function assertGroupInProject(
	groupId: string,
	projectId: string,
	tx?: Parameters<typeof findGroupById>[1],
) {
	const group = await findGroupById(groupId, tx);
	if (!group) throw new NotFoundError("Trigger group not found");
	if (group.projectId !== projectId)
		throw new BadRequestError("Trigger group belongs to a different project");
	return group.id;
}

/**
 * `internal` has no external source, so an integration on it is a
 * misconfiguration that would silently do nothing.
 */
function assertSourceMatchesType(type: string, integrationId?: string | null) {
	if (type === "internal" && integrationId)
		throw new BadRequestError("An internal trigger has no source to authenticate");
}

/**
 * An inactive trigger has no artifact at all, rather than an artifact with
 * `active: false`. A worker then has nothing to decide: what it holds is what
 * it runs.
 */
async function republish(trigger: Trigger) {
	const key = triggerKey(trigger.projectId, trigger.id);
	if (!trigger.active) return withdraw(trigger.projectId, trigger.id);

	const artifact: TriggerArtifact = {
		triggerId: trigger.id,
		projectId: trigger.projectId,
		workflowId: trigger.workflowId,
		groupId: trigger.groupId,
		type: trigger.type,
		integrationId: trigger.integrationId,
		batchSize: trigger.batchSize,
		maxWaitMs: trigger.maxWaitMs,
		maxBytes: trigger.maxBytes,
		concurrency: trigger.concurrency,
		payload: trigger.payload ?? undefined,
		publishedAt: new Date().toISOString(),
	};
	await putArtifact(key, artifact);
	logger.debug(`[triggers] published ${key}`, "TRIGGERS");
}

async function withdraw(projectId: string, triggerId: string) {
	await deleteArtifact(triggerKey(projectId, triggerId));
}

function present(row: Trigger): z.infer<typeof triggerSchema> {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		type: row.type,
		projectId: row.projectId,
		workflowId: row.workflowId,
		groupId: row.groupId,
		integrationId: row.integrationId,
		batchSize: row.batchSize,
		maxWaitMs: row.maxWaitMs,
		maxBytes: row.maxBytes,
		concurrency: row.concurrency,
		payload: row.payload ?? null,
		active: row.active,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
