import type z from "zod";
import { NotFoundError } from "../../../../../../errors/notFoundError";
import { audit } from "../../../../../../modules/audit";
import { removeProjectMember } from "../repository";
import type { requestParamSchema, responseSchema } from "./dto";

export default async function handleRequest(
	projectId: string,
	params: z.infer<typeof requestParamSchema>,
): Promise<z.infer<typeof responseSchema>> {
	const deleted = await removeProjectMember(projectId, params.userId);
	if (!deleted) {
		throw new NotFoundError("ACL not found for user in this project");
	}
	await audit.record({
		projectId,
		resourceType: "project_member",
		resourceId: params.userId,
		action: "delete",
		changedFields: [],
	});
	return "ok";
}
