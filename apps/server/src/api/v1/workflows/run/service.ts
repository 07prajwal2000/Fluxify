import { z } from "zod";
import { AuthACL } from "../../../../db/schema";
import { BadRequestError } from "../../../../errors/badRequestError";
import { enqueueJob } from "../../../../modules/jobs/publisher";
import { WORKFLOW_JOB } from "../../../../modules/jobs/subjects";
import { mustAccess } from "../access";
import { requestBodySchema, responseSchema } from "./dto";

/**
 * Queues one run of a workflow. This is the manual path the portal's test-run
 * button uses; a trigger enqueues exactly the same job.
 *
 * The response is an id, not a result. A workflow is background work — the
 * process that runs it is a worker somewhere else, and it may not even be up
 * yet when this returns.
 */
export default async function handleRequest(
	id: string,
	data: z.infer<typeof requestBodySchema>,
	userId: string,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof responseSchema>> {
	const workflow = await mustAccess(id, acl, "creator");

	// An inactive workflow has no artifact in the store, so the job would sit on
	// the queue until it aged out. Refuse now, where the caller can see why.
	if (!workflow.active)
		throw new BadRequestError("Workflow is not active — activate it to run it");

	const job = await enqueueJob({
		kind: WORKFLOW_JOB,
		projectId: workflow.projectId!,
		target: id,
		payload: data.payload,
		origin: { via: "manual", userId },
	});
	return { id: job.id, accepted: true };
}
