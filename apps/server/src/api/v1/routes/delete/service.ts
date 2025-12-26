import { z } from "zod";
import { responseSchema } from "./dto";
import { deleteRoute, findRouteById } from "./repository";
import { db } from "../../../../db";
import { publishMessage, CHAN_ON_ROUTE_CHANGE } from "../../../../db/redis";
import { AuthACL } from "../../../../db/schema";
import { canAccessProject } from "../../../../lib/acl";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ForbiddenError } from "../../../../errors/forbidError";

export default async function handleRequest(
  id: string,
  acl: AuthACL[] = []
): Promise<z.infer<typeof responseSchema>> {
  await db.transaction(async (tx) => {
    const existingRoute = await findRouteById(id, tx);
    if (!existingRoute) {
      throw new NotFoundError("Route not found");
    }
    const canAccess = canAccessProject(
      acl,
      existingRoute.projectId!,
      "creator"
    );
    if (!canAccess) {
      throw new ForbiddenError();
    }
    await deleteRoute(id, tx);
  });
  await publishMessage(CHAN_ON_ROUTE_CHANGE, id);
  return "";
}
