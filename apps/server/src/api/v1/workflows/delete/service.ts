import { z } from "zod";
import { db } from "../../../../db";
import { AuthACL } from "../../../../db/schema";
import { CHAN_ON_WORKFLOW_CHANGE, publishMessage } from "../../../../db/redis";
import { dropWorkflow } from "../../../../modules/compiler/service";
import { mustAccess } from "../access";
import { responseSchema } from "./dto";
import { deleteWorkflowRow } from "./repository";

export default async function handleRequest(
	id: string,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof responseSchema>> {
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
