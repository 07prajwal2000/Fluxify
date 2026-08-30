import { and, eq, ilike } from "drizzle-orm";
import { db, DbTransactionType } from "../../../db";
import { AuthACL, workflowsEntity } from "../../../db/schema";
import { canAccessProject } from "../../../lib/acl";
import { ForbiddenError } from "../../../errors/forbidError";
import { NotFoundError } from "../../../errors/notFoundError";

/**
 * The reads more than one action needs, and the guard built on them.
 *
 * Five of the eight actions start by loading a workflow and refusing the caller
 * who may not touch it, and two more check a name for a duplicate. Kept here
 * rather than in each action's repository so there is one definition of "this
 * workflow exists and you may have it".
 */

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
