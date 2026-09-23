import { logger } from "@fluxify/common";
import { describeSchedule, nextFires, ScheduleError } from "@fluxify/common/schedule";
import { generateID } from "@fluxify/lib";
import { and, eq, ilike, inArray, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import { type DbTransactionType, db } from "../../../db";
import { deleteArtifact, putArtifact } from "../../../db/natsKv";
import { type AuthACL, triggersEntity } from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { ConflictError } from "../../../errors/conflictError";
import { ForbiddenError } from "../../../errors/forbidError";
import { NotFoundError } from "../../../errors/notFoundError";
import { canAccessProject } from "../../../lib/acl";
import { assertCanUse } from "../../../lib/edition";
import type { TriggerArtifact } from "../../../modules/compiler/artifacts";
import { triggerKey } from "../../../modules/compiler/subjects";
import { removeSchedule, upsertSchedule } from "../../../modules/schedules/reconciler";
import { assertConnector } from "./connectors.ee";
import {
	type createSchema,
	isEnterpriseTriggerType,
	type listQuerySchema,
	type listSchema,
	type patchSchema,
	type previewQuerySchema,
	type previewSchema,
	type triggerSchema,
} from "./dto";
import { groupCapRefusal } from "./groupCap";
import {
	deleteTriggerRow,
	ensureDefaultGroup,
	findGroupById,
	findTriggerById,
	findTriggerByName,
	findWorkflow,
	insertTrigger,
	listTriggers,
	lockGroupTriggerCount,
	projectExists,
	updateTriggerRow,
	workflowNames,
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
	if (isEnterpriseTriggerType(data.type)) assertCanUse("connectors");

	let warnings: string[] = [];
	const created = await db.transaction(async (tx) => {
		if (!(await projectExists(data.projectId, tx)))
			throw new NotFoundError(`project with id ${data.projectId} does not exist`);

		if (data.workflowId) await assertWorkflowInProject(data.workflowId, data.projectId, tx);
		warnings = await assertConnector({ ...data, probe: true }, tx);

		if (await findTriggerByName(data.projectId, data.name, tx))
			throw new ConflictError("trigger with that name already exists");

		const groupId = data.groupId
			? await assertGroupInProject(data.groupId, data.projectId, tx)
			: await ensureDefaultGroup(data.projectId, userId, tx);
		await assertGroupHasRoom(groupId, 1, tx);

		const id = await insertTrigger(
			{
				id: generateID(),
				name: data.name,
				description: data.description,
				type: data.type,
				projectId: data.projectId,
				workflowId: data.workflowId ?? null,
				groupId,
				integrationId: data.integrationId ?? null,
				batchSize: data.batchSize,
				maxWaitMs: data.maxWaitMs,
				maxBytes: data.maxBytes,
				concurrency: data.concurrency,
				payload: data.payload ?? null,
				source: data.source ?? null,
				commitMode: data.commitMode,
				maxAttempts: data.maxAttempts,
				retryDelayMs: data.retryDelayMs,
				schedule: data.schedule ?? null,
				timezone: data.timezone,
				active: data.active ?? false,
				createdBy: userId,
			},
			tx,
		);
		return (await findTriggerById(id, tx))!;
	});

	await republish(created);
	return { id: created.id, warnings };
}

export async function updateTrigger(
	id: string,
	data: z.infer<typeof patchSchema>,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof triggerSchema> & { warnings: string[] }> {
	let warnings: string[] = [];
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
		// staying put is never refused, so a group already over the cap stays editable
		if (groupId && groupId !== existing.groupId) await assertGroupHasRoom(groupId, 1, tx);

		if (data.workflowId) await assertWorkflowInProject(data.workflowId, existing.projectId, tx);
		// enabling proves the credentials and the source still work, however long it sat off
		const enabling = data.active === true && !existing.active;
		warnings = await assertConnector(
			{
				type: existing.type,
				projectId: existing.projectId,
				integrationId: data.integrationId ?? existing.integrationId,
				source: data.source ?? existing.source,
				batchSize: data.batchSize ?? existing.batchSize,
				probe: enabling || data.source !== undefined || data.integrationId !== undefined,
			},
			tx,
		);

		return (await updateTriggerRow(
			id,
			{
				...data,
				...(groupId ? { groupId } : {}),
				...(data.payload === undefined ? {} : { payload: data.payload }),
				...(enabling ? { disabledReason: null } : {}),
			},
			tx,
		))!;
	});

	await republish(updated);
	return { ...present(updated), warnings };
}

/**
 * The system switching a trigger off, e.g. because its queue was deleted. The
 * row keeps the reason until a user re-enables it, which checks the source again.
 */
export async function disableTrigger(id: string, projectId: string, reason: string) {
	const existing = await findTriggerById(id);
	// a trigger the worker does not really own, or one a user already switched off
	if (!existing || existing.projectId !== projectId || !existing.active) return;
	const disabled = (await updateTriggerRow(id, { active: false, disabledReason: reason }))!;
	await republish(disabled);
	logger.warn(`[triggers] disabled ${id}: ${reason}`, "TRIGGERS");
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
	return present(await mustAccess(id, acl, "viewer"));
}

/**
 * Attaching and detaching, which is what a workflow's own settings page does.
 *
 * Attaching a trigger that already starts a different workflow is refused, not
 * silently moved: taking a live source away from one workflow is not something
 * another workflow's settings page should do as a side effect.
 */
export async function attachWorkflow(triggerId: string, workflowId: string, acl: AuthACL[] = []) {
	const trigger = await db.transaction(async (tx) => {
		const existing = await mustAccess(triggerId, acl, "creator", tx);
		if (existing.workflowId === workflowId) return existing;
		if (existing.workflowId)
			throw new ConflictError(
				"This trigger already starts another workflow. Detach it there first, or create a new trigger",
			);
		await assertWorkflowInProject(workflowId, existing.projectId, tx);
		// an enabled trigger with no workflow starts consuming the moment it gets one
		if (existing.active) await assertConnector({ ...existing, probe: true }, tx);
		return (await updateTriggerRow(triggerId, { workflowId }, tx))!;
	});
	await republish(trigger);
	return present(trigger);
}

/** Detaching a workflow the trigger does not start is a no-op, not an error. */
export async function detachWorkflow(triggerId: string, workflowId: string, acl: AuthACL[] = []) {
	const trigger = await db.transaction(async (tx) => {
		const existing = await mustAccess(triggerId, acl, "creator", tx);
		if (existing.workflowId !== workflowId) return existing;
		return (await updateTriggerRow(triggerId, { workflowId: null }, tx))!;
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
		query.workflowId ? eq(triggersEntity.workflowId, query.workflowId) : undefined,
		query.groupId ? eq(triggersEntity.groupId, query.groupId) : undefined,
		query.active === undefined ? undefined : eq(triggersEntity.active, query.active),
		query.search ? ilike(triggersEntity.name, `%${query.search}%`) : undefined,
	];
	const filter = and(...filters.filter(Boolean)) ?? sql`1=1`;

	const { result, totalCount } = await listTriggers(offset, query.perPage, filter);
	const names = await workflowNames(
		result.flatMap((row) => (row.workflowId ? [row.workflowId] : [])),
	);
	return {
		pagination: {
			page: query.page,
			totalPages: Math.ceil(totalCount / query.perPage),
			hasNext: offset + result.length < totalCount,
		},
		data: result.map((row) => ({
			...present(row),
			workflow: row.workflowId
				? { id: row.workflowId, name: names.get(row.workflowId) ?? "" }
				: null,
		})),
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
			nextFires: nextFires(query.schedule, query.timezone, 5).map((at) => at.toISOString()),
		};
	} catch (error) {
		// A half-typed cron is the normal state of this endpoint, not an
		// exception worth a 500.
		throw new BadRequestError(error instanceof ScheduleError ? error.message : String(error));
	}
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
 * The workflow a trigger points at must live in the same project. A trigger
 * firing another tenant's workflow would be a boundary crossed by a dropdown,
 * so it is refused here rather than at run time.
 */
async function assertWorkflowInProject(
	workflowId: string,
	projectId: string,
	tx?: Parameters<typeof findWorkflow>[1],
) {
	const workflow = await findWorkflow(workflowId, tx);
	if (!workflow) throw new NotFoundError(`Workflow ${workflowId} not found`);
	if (workflow.projectId !== projectId)
		throw new BadRequestError("Workflow belongs to a different project");
}

/** Refuses when `incoming` more triggers would take a group past its cap. */
export async function assertGroupHasRoom(groupId: string, incoming: number, tx: DbTransactionType) {
	const refusal = groupCapRefusal(await lockGroupTriggerCount(groupId, tx), incoming);
	if (refusal) throw new BadRequestError(refusal);
}

export async function assertGroupInProject(
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
export async function republish(trigger: Trigger) {
	if (trigger.type === "schedule") return republishSchedule(trigger);
	const key = triggerKey(trigger.projectId, trigger.id);
	// No workflow is the same as inactive as far as a worker is concerned: a
	// consumer that read events and had nowhere to send them would drain the
	// source into nothing.
	if (!trigger.active || !trigger.workflowId) return withdraw(trigger.projectId, trigger.id);

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
		source: (trigger.source as Record<string, unknown> | null) ?? undefined,
		commitMode: trigger.commitMode === "manual" ? "manual" : "auto",
		maxAttempts: trigger.maxAttempts,
		retryDelayMs: trigger.retryDelayMs,
		publishedAt: new Date().toISOString(),
	};
	await putArtifact(key, artifact);
	logger.debug(`[triggers] published ${key}`, "TRIGGERS");
}

export async function withdraw(projectId: string, triggerId: string) {
	await deleteArtifact(triggerKey(projectId, triggerId));
}

/**
 * Pause is a purge with the row left inactive, and resume is an upsert. There
 * is no third state: a schedule either exists on the broker or it does not, and
 * the row is what says which it should be.
 */
async function republishSchedule(trigger: Trigger) {
	if (!trigger.active || !trigger.schedule) return removeSchedule(trigger.projectId, trigger.id);
	await upsertSchedule({
		id: trigger.id,
		projectId: trigger.projectId,
		workflowId: trigger.workflowId,
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
		workflowId: row.workflowId,
		groupId: row.groupId,
		integrationId: row.integrationId,
		batchSize: row.batchSize,
		maxWaitMs: row.maxWaitMs,
		maxBytes: row.maxBytes,
		concurrency: row.concurrency,
		payload: row.payload ?? null,
		source: row.source ?? null,
		commitMode: row.commitMode,
		maxAttempts: row.maxAttempts,
		retryDelayMs: row.retryDelayMs,
		schedule: row.schedule,
		timezone: row.timezone,
		active: row.active,
		disabledReason: row.disabledReason,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
