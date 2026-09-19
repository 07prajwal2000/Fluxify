import type z from "zod";
import { NotFoundError } from "../../../../../../errors/notFoundError";
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
	return "ok";
}
