import z from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import {
  createDependency,
  createRoute,
  checkRouteExist,
  checkProjectExist,
} from "./repository";
import { ConflictError } from "../../../../errors/conflictError";
import { db, DbTransactionType } from "../../../../db";
import { CHAN_ON_ROUTE_CHANGE, publishMessage } from "../../../../db/redis";
import { generateID } from "@fluxify/lib";
import { NotFoundError } from "../../../../errors/notFoundError";
import { HttpMethod } from "../../../../db/schema";
import { patchRouteConfig } from "../routeConfigRepository";
import { DEFAULT_CONTENT_TYPES } from "../../../../lib/routeConfig";

/**
 * `outer` joins a transaction already in progress, so the ops bus can create a
 * route and its canvas atomically. The change signal is then the caller's to
 * publish once that transaction commits.
 */
export default async function handleRequest(
  userId: string,
  data: z.infer<typeof requestBodySchema>,
  outer?: DbTransactionType
): Promise<z.infer<typeof responseSchema>> {
  const result = await (outer ?? db).transaction(async (tx) => {
    const projectExist = await checkProjectExist(data.projectId, tx);
    if (!projectExist) {
      throw new NotFoundError(
        `project with id ${data.projectId} does not exist`
      );
    }
    const existingRoute = await checkRouteExist(
      data.name,
      data.path,
      data.method as HttpMethod,
      tx
    );
    if (existingRoute) {
      throw new ConflictError(`route with name or path already exist`);
    }
    const id = generateID();
    const { acceptedContentTypes, ...route } = data;
    const newRouteId = await createRoute(
      { ...route, id, createdBy: userId },
      tx
    );
    await createDependency(newRouteId, tx);
    await patchRouteConfig(
      newRouteId,
      data.projectId,
      { acceptedContentTypes: acceptedContentTypes ?? DEFAULT_CONTENT_TYPES },
      tx
    );
    return {
      id: newRouteId,
    };
  });
  if (!outer) await publishMessage(CHAN_ON_ROUTE_CHANGE, result.id);
  return result;
}
