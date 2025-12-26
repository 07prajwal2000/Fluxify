import { z } from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import { db } from "../../../../db";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ConflictError } from "../../../../errors/conflictError";
import { getRouteByNameOrPath, updateRoute } from "../update/repository";
import { publishMessage, CHAN_ON_ROUTE_CHANGE } from "../../../../db/redis";
import { ServerError } from "../../../../errors/serverError";
import { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";

export default async function handleRequest(
  id: string,
  data: z.infer<typeof requestBodySchema>,
  acl: AuthACL[] = []
): Promise<z.infer<typeof responseSchema>> {
  const result = await db.transaction(async (tx) => {
    const existingRoute = await getRouteByNameOrPath(
      id,
      data.name ?? "",
      data.path ?? "",
      data.method ?? ("NONE" as any),
      tx
    );
    if (!existingRoute) {
      throw new NotFoundError("Route not found");
    }
    const hasAccess = acl.some(
      (entry) =>
        entry.projectId === existingRoute.projectId || entry.projectId === "*"
    );
    if (!hasAccess) {
      throw new ForbiddenError();
    }
    if (existingRoute.id !== id) {
      throw new ConflictError("Route already exists");
    }
    const patchedRoute = existingRoute;
    if (data.name) patchedRoute.name = data.name;
    if (data.path) patchedRoute.path = data.path;
    if (data.method) patchedRoute.method = data.method;
    if (data.active !== undefined) patchedRoute.active = data.active;
    return await updateRoute(
      {
        ...patchedRoute,
        id,
        updatedAt: new Date(),
      },
      tx
    );
  });
  if (!result) {
    throw new ServerError("Something went wrong while updating the route");
  }
  await publishMessage(CHAN_ON_ROUTE_CHANGE, id);
  return {
    id: result.id,
    name: result.name!,
    path: result.path!,
    method: result.method!,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}
