import type z from "zod";
import { ConflictError } from "../../../../../../errors/conflictError";
import { addProjectMember, projectMemberExists } from "../repository";
import type { requestBodySchema, responseSchema } from "./dto";

export default async function handleRequest(
	projectId: string,
	body: z.infer<typeof requestBodySchema>,
): Promise<z.infer<typeof responseSchema>> {
	const exists = await projectMemberExists(projectId, body.userId);
	if (exists) {
		throw new ConflictError("Member already exists");
	}
	const created = await addProjectMember(projectId, body.userId, body.role);
	return { id: created.id! };
}
