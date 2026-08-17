import { z } from "zod";
import { responseSchema } from "./dto";
import { deleteRoute, findRouteById } from "./repository";
import { db } from "../../../../db";
import { publishMessage, CHAN_ON_ROUTE_CHANGE } from "../../../../db/redis";
import { AuthACL } from "../../../../db/schema";
import { canAccessProject } from "../../../../lib/acl";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ForbiddenError } from "../../../../errors/forbidError";
import { dropRoute } from "../../../../modules/compiler/service";

export default async function handleRequest(
  id: string,
  acl: AuthACL[] = []
): Promise<z.infer<typeof responseSchema>> {
  let projectId: string | undefined;
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
    projectId = existingRoute.projectId!;
    await deleteRoute(id, tx);
  });
  // the compiler resolves a route's project from the database, so once the row
  // is gone it can no longer work out which artifact key to drop — workers would
  // keep serving the deleted route from KV. Drop it here, where we still know.
  if (projectId) await dropRoute(projectId, id);
  await publishMessage(CHAN_ON_ROUTE_CHANGE, id);
  return "";
}
