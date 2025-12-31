import z from "zod";
import { requestParamSchema, responseSchema } from "./dto";
import { removeProjectMember } from "../repository";
import { NotFoundError } from "../../../../../../errors/notFoundError";

export default async function handleRequest(
  projectId: string,
  params: z.infer<typeof requestParamSchema>
): Promise<z.infer<typeof responseSchema>> {
  const deleted = await removeProjectMember(projectId, params.userId);
  if (!deleted) {
    throw new NotFoundError("ACL not found for user in this project");
  }
  return "ok";
}
