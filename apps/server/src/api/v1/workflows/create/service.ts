import { z } from "zod";
import { db, DbTransactionType } from "../../../../db";
import { AuthACL } from "../../../../db/schema";
import { CHAN_ON_WORKFLOW_CHANGE, publishMessage } from "../../../../db/redis";
import { canAccessProject } from "../../../../lib/acl";
import { ConflictError } from "../../../../errors/conflictError";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { findWorkflowByName } from "../access";
import { requestBodySchema, responseSchema } from "./dto";
import { insertWorkflow, projectExists, seedDefaultBlocks } from "./repository";

/**
 * Creates a workflow and its starting canvas. The write ends in a change
 * signal, which is what puts the workflow on the compile queue — the same path
 * a route edit takes.
 */
export default async function handleRequest(
	userId: string,
	data: z.infer<typeof requestBodySchema>,
	acl: AuthACL[] = [],
	/** Joins a transaction already in progress — the ops bus creates a workflow
	 *  and its canvas atomically, and publishes the signal itself after commit. */
	outer?: DbTransactionType,
	/** Caller-chosen id, so a canvas generated before the write keeps its target. */
	presetId?: string,
	/** false when the caller writes its own canvas, which carries its own
	 *  entrypoint and error handler — seeding would collide with it. */
	seedBlocks = true,
): Promise<z.infer<typeof responseSchema>> {
	if (!canAccessProject(acl, data.projectId, "creator")) throw new ForbiddenError();

	const result = await (outer ?? db).transaction(async (tx) => {
		if (!(await projectExists(data.projectId, tx)))
			throw new NotFoundError(`project with id ${data.projectId} does not exist`);
		if (await findWorkflowByName(data.projectId, data.name, tx))
			throw new ConflictError("workflow with that name already exists");

		const id = await insertWorkflow({ ...data, id: presetId, createdBy: userId }, tx);
		if (seedBlocks) await seedDefaultBlocks(id, tx);
		return { id };
	});

	if (!outer) await publishMessage(CHAN_ON_WORKFLOW_CHANGE, result.id);
	return result;
}
