import { z } from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import { db } from "../../../../db";
import { getRouteByNameOrPath, updateRoute } from "./repository";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ConflictError } from "../../../../errors/conflictError";
import { ServerError } from "../../../../errors/serverError";
import { publishMessage, CHAN_ON_ROUTE_CHANGE } from "../../../../db/redis";
import { normalizeParamsSchema } from "../schema-validator";
import { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";

export default async function handleRequest(
  id: string,
  data: z.infer<typeof requestBodySchema>,
  acl: AuthACL[] = [],
): Promise<z.infer<typeof responseSchema>> {
  const result = await db.transaction(async (tx) => {
    const existingRoute = await getRouteByNameOrPath(
      id,
      data.name,
      data.path,
      data.method,
      tx,
    );
    if (!existingRoute) {
      throw new NotFoundError("Route not found");
    }
    const hasAccess = acl.some(
      (entry) =>
        entry.projectId === existingRoute.projectId || entry.projectId === "*",
    );
    if (!hasAccess) {
      throw new ForbiddenError();
    }
    if (existingRoute.id !== id) {
      throw new ConflictError("Route already exists");
    }
    // An undefined field is skipped by the update statement, so an omitted
    // paramsSchema would leave the previous one behind. Normalise so a path
    // that no longer declares `:params` writes an explicit null instead.
    return await updateRoute(
      {
        id,
        ...normalizeParamsSchema(data),
      },
      tx,
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
		timeoutSeconds: result.timeoutSeconds,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}
