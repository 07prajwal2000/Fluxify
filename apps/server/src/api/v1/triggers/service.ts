import { z } from "zod";
import { and, eq, ilike, inArray, SQL, sql } from "drizzle-orm";
import { logger } from "@fluxify/common";
import { generateID } from "@fluxify/lib";
import { db } from "../../../db";
import { AuthACL, triggersEntity } from "../../../db/schema";
import { canAccessProject } from "../../../lib/acl";
import { assertCanCreateConnector } from "../../../lib/edition";
import { BadRequestError } from "../../../errors/badRequestError";
import { ConflictError } from "../../../errors/conflictError";
import { ForbiddenError } from "../../../errors/forbidError";
import { NotFoundError } from "../../../errors/notFoundError";
import { deleteArtifact, putArtifact } from "../../../db/natsKv";
import type { TriggerArtifact } from "../../../modules/compiler/artifacts";
import { triggerKey } from "../../../modules/compiler/subjects";
import { removeSchedule, upsertSchedule } from "../../../modules/schedules/reconciler";
import { describeSchedule, nextFires, ScheduleError } from "@fluxify/common/schedule";
import {
	createGroupSchema,
	createSchema,
	groupSchema,
	isEnterpriseTriggerType,
	listQuerySchema,
	listSchema,
	patchSchema,
	previewQuerySchema,
	previewSchema,
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
	linkWorkflow,
	listGroups,
	listTriggers,
	projectExists,
	setWorkflowLinks,
	triggerIdsForWorkflow,
	unlinkWorkflow,
	updateTriggerRow,
	workflowIdsFor,
	workflowsForTriggers,
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

type TriggerRow = Omit<typeof triggersEntity.$inferSelect, "createdBy">;
/** A row plus the links it needs to be published or presented. */
type Trigger = TriggerRow & { workflowIds: string[] };

export async function createTrigger(
	userId: string,
	data: z.infer<typeof createSchema>,
	acl: AuthACL[] = [],
) {
	if (!canAccessProject(acl, data.projectId, "creator")) throw new ForbiddenError();
	assertSourceMatchesType(data.type, data.integrationId);
	if (isEnterpriseTriggerType(data.type)) assertCanCreateConnector();

	const created = await db.transaction(async (tx) => {
		if (!(await projectExists(data.projectId, tx)))
			throw new NotFoundError(`project with id ${data.projectId} does not exist`);

		await assertWorkflowsInProject(data.workflowIds, data.projectId, tx);

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
				groupId,
				integrationId: data.integrationId ?? null,
				batchSize: data.batchSize,
				maxWaitMs: data.maxWaitMs,
				maxBytes: data.maxBytes,
				concurrency: data.concurrency,
				payload: data.payload ?? null,
				schedule: data.schedule ?? null,
				timezone: data.timezone,
				active: data.active ?? false,
				createdBy: userId,
			},
			tx,
		);
		await setWorkflowLinks(id, data.workflowIds, tx);
		return { ...(await findTriggerById(id, tx))!, workflowIds: data.workflowIds };
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

		if (data.workflowIds) {
			await assertWorkflowsInProject(data.workflowIds, existing.projectId, tx);
			await setWorkflowLinks(id, data.workflowIds, tx);
		}

		// `workflowIds` is not a column; it went to the join table above.
		const { workflowIds: _links, ...columns } = data;
		const row = (await updateTriggerRow(
			id,
			{
				...columns,
				...(groupId ? { groupId } : {}),
				...(data.payload === undefined ? {} : { payload: data.payload }),
			},
			tx,
		))!;
		return { ...row, workflowIds: await workflowIdsFor(id, tx) };
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
	// A schedule outliving its row is worse still — nothing would ever stop it.
	if (existing.type === "schedule") await removeSchedule(existing.projectId, id);
	else await withdraw(existing.projectId, id);
	return { id };
}

export async function getTrigger(
	id: string,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof triggerSchema>> {
	const trigger = await mustAccess(id, acl, "viewer");
	return present({ ...trigger, workflowIds: await workflowIdsFor(id) });
}

/**
 * Attaching and detaching one workflow, which is what a workflow's own settings
 * page does.
 *
 * Deliberately not a PATCH of the whole `workflowIds` set: that page knows about
 * one link and would have to send back a list it read some time ago, silently
 * dropping whatever another tab attached in between.
 */
export async function attachWorkflow(
	triggerId: string,
	workflowId: string,
	acl: AuthACL[] = [],
) {
	const trigger = await db.transaction(async (tx) => {
		const existing = await mustAccess(triggerId, acl, "creator", tx);
		await assertWorkflowsInProject([workflowId], existing.projectId, tx);
		await linkWorkflow(triggerId, workflowId, tx);
		return { ...existing, workflowIds: await workflowIdsFor(triggerId, tx) };
	});
	await republish(trigger);
	return present(trigger);
}

export async function detachWorkflow(
	triggerId: string,
	workflowId: string,
	acl: AuthACL[] = [],
) {
	const trigger = await db.transaction(async (tx) => {
		const existing = await mustAccess(triggerId, acl, "creator", tx);
		await unlinkWorkflow(triggerId, workflowId, tx);
		return { ...existing, workflowIds: await workflowIdsFor(triggerId, tx) };
	});
	await republish(trigger);
	return present(trigger);
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
		query.workflowId
			? inArray(triggersEntity.id, triggerIdsForWorkflow(query.workflowId))
			: undefined,
		query.groupId ? eq(triggersEntity.groupId, query.groupId) : undefined,
		query.active === undefined ? undefined : eq(triggersEntity.active, query.active),
		query.search ? ilike(triggersEntity.name, `%${query.search}%`) : undefined,
	];
	const filter = and(...filters.filter(Boolean)) ?? sql`1=1`;

	const { result, totalCount } = await listTriggers(offset, query.perPage, filter);
	const links = await workflowsForTriggers(result.map((row) => row.id));
	return {
		pagination: {
			page: query.page,
			totalPages: Math.ceil(totalCount / query.perPage),
			hasNext: offset + result.length < totalCount,
		},
		data: result.map((row) => {
			const workflows = links.get(row.id) ?? [];
			return {
				...present({
					...(row as TriggerRow),
					workflowIds: workflows.map((workflow) => workflow.id),
				}),
				workflows,
			};
		}),
	};
}

/**
 * What a schedule spec means, and when it fires next.
 *
 * Needs no project and touches no row: it is a pure reading of the string the
 * user is typing, which is why the form can call it on every keystroke.
 */
export function previewSchedule(
	query: z.infer<typeof previewQuerySchema>,
): z.infer<typeof previewSchema> {
	try {
		return {
			description: describeSchedule(query.schedule, query.timezone),
			nextFires: nextFires(query.schedule, query.timezone, 5).map((at) =>
				at.toISOString(),
			),
		};
	} catch (error) {
		// A half-typed cron is the normal state of this endpoint, not an
		// exception worth a 500.
		throw new BadRequestError(
			error instanceof ScheduleError ? error.message : String(error),
		);
	}
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

/**
 * Every workflow a trigger points at must live in the same project. A trigger
 * firing another tenant's workflow would be a boundary crossed by a dropdown,
 * so it is refused here rather than at run time.
 */
async function assertWorkflowsInProject(
	workflowIds: string[],
	projectId: string,
	tx?: Parameters<typeof findWorkflow>[1],
) {
	for (const workflowId of new Set(workflowIds)) {
		const workflow = await findWorkflow(workflowId, tx);
		if (!workflow) throw new NotFoundError(`Workflow ${workflowId} not found`);
		if (workflow.projectId !== projectId)
			throw new BadRequestError("Workflow belongs to a different project");
	}
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
	if ((type === "internal" || type === "schedule") && integrationId)
		throw new BadRequestError(`A ${type} trigger has no source to authenticate`);
}

/**
 * An inactive trigger has no artifact at all, rather than an artifact with
 * `active: false`. A worker then has nothing to decide: what it holds is what
 * it runs.
 *
 * A scheduled trigger takes the other path entirely. It has no events to pull,
 * so it gets no consumer and no artifact — the broker holds its schedule and
 * the fire consumer turns each fire straight into a job.
 */
async function republish(trigger: Trigger) {
	if (trigger.type === "schedule") return republishSchedule(trigger);
	const key = triggerKey(trigger.projectId, trigger.id);
	// No workflows is the same as inactive as far as a worker is concerned: a
	// consumer that read events and had nowhere to send them would drain the
	// source into nothing.
	if (!trigger.active || trigger.workflowIds.length === 0)
		return withdraw(trigger.projectId, trigger.id);

	const artifact: TriggerArtifact = {
		triggerId: trigger.id,
		projectId: trigger.projectId,
		workflowIds: trigger.workflowIds,
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

/**
 * Pause is a purge with the row left inactive, and resume is an upsert. There
 * is no third state: a schedule either exists on the broker or it does not, and
 * the row is what says which it should be.
 */
async function republishSchedule(trigger: Trigger) {
	if (!trigger.active || !trigger.schedule)
		return removeSchedule(trigger.projectId, trigger.id);
	await upsertSchedule({
		id: trigger.id,
		projectId: trigger.projectId,
		workflowIds: trigger.workflowIds,
		schedule: trigger.schedule,
		timezone: trigger.timezone,
		payload: trigger.payload ?? undefined,
	});
}

function present(row: Trigger): z.infer<typeof triggerSchema> {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		type: row.type,
		projectId: row.projectId,
		workflowIds: row.workflowIds,
		groupId: row.groupId,
		integrationId: row.integrationId,
		batchSize: row.batchSize,
		maxWaitMs: row.maxWaitMs,
		maxBytes: row.maxBytes,
		concurrency: row.concurrency,
		payload: row.payload ?? null,
		schedule: row.schedule,
		timezone: row.timezone,
		active: row.active,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
