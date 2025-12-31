import z from "zod";
import { requestBodySchema, requestParamSchema, responseSchema } from "./dto";
import { updateProjectMemberRole } from "../repository";
import { NotFoundError } from "../../../../../../errors/notFoundError";

export default async function handleRequest(
  projectId: string,
  params: z.infer<typeof requestParamSchema>,
  body: z.infer<typeof requestBodySchema>
): Promise<z.infer<typeof responseSchema>> {
  const updated = await updateProjectMemberRole(projectId, params.userId, body.role);
  if (!updated) {
    throw new NotFoundError("ACL not found for user in this project");
  }
  return {
    id: updated.id!,
    userId: updated.userId ?? null,
    projectId: updated.projectId ?? null,
    role: updated.role!,
    createdAt: updated.createdAt ? updated.createdAt.toISOString() : null,
    updatedAt: updated.updatedAt ? updated.updatedAt.toISOString() : null,
  };
}
