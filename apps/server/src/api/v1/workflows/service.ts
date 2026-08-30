import { z } from "zod";
import { and, eq, ilike, inArray, SQL, sql } from "drizzle-orm";
import { db, DbTransactionType } from "../../../db";
import { AuthACL, workflowsEntity } from "../../../db/schema";
import { CHAN_ON_WORKFLOW_CHANGE, publishMessage } from "../../../db/redis";
import { canAccessProject } from "../../../lib/acl";
import { ConflictError } from "../../../errors/conflictError";
import { ForbiddenError } from "../../../errors/forbidError";
import { NotFoundError } from "../../../errors/notFoundError";
import { dropWorkflow } from "../../../modules/compiler/service";
import {
	createSchema,
	listQuerySchema,
	listSchema,
	patchSchema,
	workflowSchema,
} from "./dto";
import {
	deleteWorkflowRow,
	findWorkflowById,
	findWorkflowByName,
	insertWorkflow,
	listWorkflows,
	projectExists,
	seedDefaultBlocks,
	updateWorkflowRow,
} from "./repository";

/**
 * Workflow CRUD. Every write ends in a change signal, which is what puts the
 * workflow on the compile queue — the same path a route edit takes.
 */

/** Everything the API returns. `createdBy` is not part of it, so the list
 *  query need not select it. */
type Workflow = Omit<typeof workflowsEntity.$inferSelect, "createdBy">;

export async function createWorkflow(
	userId: string,
	data: z.infer<typeof createSchema>,
	acl: AuthACL[] = [],
	/** Joins a transaction already in progress — the ops bus creates a workflow
	 *  and its canvas atomically, and publishes the signal itself after commit. */
	outer?: DbTransactionType,
	/** Caller-chosen id, so a canvas generated before the write keeps its target. */
	presetId?: string,
	/** false when the caller writes its own canvas, which carries its own
	 *  entrypoint and error handler — seeding would collide with it. */
	seedBlocks = true,
) {
	if (!canAccessProject(acl, data.projectId, "creator")) throw new ForbiddenError();

	const result = await (outer ?? db).transaction(async (tx) => {
		if (!(await projectExists(data.projectId, tx)))
			throw new NotFoundError(`project with id ${data.projectId} does not exist`);
		if (await findWorkflowByName(data.projectId, data.name, tx))
			throw new ConflictError("workflow with that name already exists");

		const id = await insertWorkflow(
			{ ...data, id: presetId, createdBy: userId },
			tx,
		);
		if (seedBlocks) await seedDefaultBlocks(id, tx);
		return { id };
	});

	if (!outer) await publishMessage(CHAN_ON_WORKFLOW_CHANGE, result.id);
	return result;
}

export async function updateWorkflow(
	id: string,
	data: z.infer<typeof patchSchema>,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof workflowSchema>> {
	const updated = await db.transaction(async (tx) => {
		const existing = await mustAccess(id, acl, "creator", tx);
		if (
			data.name &&
			data.name !== existing.name &&
			(await findWorkflowByName(existing.projectId!, data.name, tx))
		)
			throw new ConflictError("workflow with that name already exists");

		return await updateWorkflowRow(id, data, tx);
	});

	await publishMessage(CHAN_ON_WORKFLOW_CHANGE, id);
	return present(updated!);
}

export async function deleteWorkflow(id: string, acl: AuthACL[] = []) {
	let projectId: string | undefined;
	await db.transaction(async (tx) => {
		projectId = (await mustAccess(id, acl, "creator", tx)).projectId!;
		await deleteWorkflowRow(id, tx);
	});

	// Same reason as routes: once the row is gone the compiler cannot resolve
	// which artifact key belongs to it, so workers would keep the deleted
	// workflow loaded. Drop it here, while the project is still known.
	if (projectId) await dropWorkflow(projectId, id);
	await publishMessage(CHAN_ON_WORKFLOW_CHANGE, id);
	return { id };
}

export async function getWorkflow(
	id: string,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof workflowSchema>> {
	return present(await mustAccess(id, acl, "viewer"));
}

export async function listAllWorkflows(
	query: z.infer<typeof listQuerySchema>,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof listSchema>> {
	const offset = query.perPage * (query.page - 1);
	const isSystemAdmin = acl.some((a) => a.projectId === "*");
	const filters: (SQL | undefined)[] = [
		isSystemAdmin
			? undefined
			: inArray(
					workflowsEntity.projectId,
					acl.map((a) => a.projectId),
				),
		query.projectId ? eq(workflowsEntity.projectId, query.projectId) : undefined,
		query.active === undefined
			? undefined
			: eq(workflowsEntity.active, query.active),
		query.search ? ilike(workflowsEntity.name, `%${query.search}%`) : undefined,
	];
	const filter = and(...filters.filter(Boolean)) ?? sql`1=1`;

	const { result, totalCount } = await listWorkflows(offset, query.perPage, filter);
	return {
		pagination: {
			page: query.page,
			totalPages: Math.ceil(totalCount / query.perPage),
			hasNext: offset + result.length < totalCount,
		},
		data: result.map((row) => ({
			...present(row),
			projectName: row.projectName ?? "",
		})),
	};
}

/** Loads a workflow and refuses the caller who may not touch it. */
export async function mustAccess(
	id: string,
	acl: AuthACL[],
	role: "viewer" | "creator",
	tx?: DbTransactionType,
) {
	const workflow = await findWorkflowById(id, tx);
	if (!workflow) throw new NotFoundError("Workflow not found");
	if (!canAccessProject(acl, workflow.projectId!, role)) throw new ForbiddenError();
	return workflow;
}

function present(row: Workflow): z.infer<typeof workflowSchema> {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		active: row.active,
		timeoutSeconds: row.timeoutSeconds,
		tracingEnabled: row.tracingEnabled,
		recordExecution: row.recordExecution,
		projectId: row.projectId!,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
