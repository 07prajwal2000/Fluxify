import { z } from "zod";
import { db } from "../../../../db";
import { AuthACL } from "../../../../db/schema";
import { CHAN_ON_WORKFLOW_CHANGE, publishMessage } from "../../../../db/redis";
import { ConflictError } from "../../../../errors/conflictError";
import { findWorkflowByName, mustAccess } from "../access";
import { present } from "../shared";
import { requestBodySchema, responseSchema } from "./dto";
import { updateWorkflowRow } from "./repository";

/** Patches a workflow. The change signal is what recompiles it. */
export default async function handleRequest(
	id: string,
	data: z.infer<typeof requestBodySchema>,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof responseSchema>> {
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
