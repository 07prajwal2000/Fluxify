import { z } from "zod";
import { AuthACL } from "../../../../db/schema";
import { canAccess } from "../../../../lib/acl";
import { saveCanvas } from "../../../../modules/canvas/service";
import { requestBodySchema } from "./dto";

export default async function handleRequest(
	workflowId: string,
	data: z.infer<typeof requestBodySchema>,
	acl: AuthACL[],
) {
	await saveCanvas(
		{ type: "workflow", id: workflowId },
		data,
		acl.filter((a) => canAccess(a.role, "creator")).map((a) => a.projectId),
	);
}
