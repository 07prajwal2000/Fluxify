import z from "zod";
import { NotFoundError } from "../../../../errors/notFoundError";
import { getRouteById } from "./repository";
import { responseSchema } from "./dto";
import { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";

export default async function handleRequest(
  id: string,
  acl: AuthACL[] = []
): Promise<z.infer<typeof responseSchema>> {
  const route = await getRouteById(id);
  if (!route) {
    throw new NotFoundError("no route found with id: " + id);
  }
  const hasAccess = acl.some(
    (a) => a.projectId === route.projectId || a.projectId === "*"
  );
  if (!hasAccess) {
    throw new ForbiddenError();
  }
  return {
    id: route.id,
    name: route.name!,
    path: route.path!,
    active: route.active!,
    projectId: route.projectId!,
    method: route.method!,
    createdBy: route.createdBy!,
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString(),
    projectName: route.projectName!,
  };
}
