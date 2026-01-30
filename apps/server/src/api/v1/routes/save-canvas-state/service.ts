import { z } from "zod";
import { requestBodySchema } from "./dto";
import {
  deleteBlocks,
  deleteEdges,
  routeExist,
  upsertBlocks,
  insertEdges,
  getBlocksCountByType,
} from "./repository";
import { NotFoundError } from "../../../../errors/notFoundError";
import { db } from "../../../../db";
import { ServerError } from "../../../../errors/serverError";
import { CHAN_ON_ROUTE_CHANGE, publishMessage } from "../../../../db/redis";
import { AuthACL } from "../../../../db/schema";
import { BlockTypes } from "@fluxify/blocks";
import { BadRequestError } from "../../../../errors/badRequestError";

export default async function handleRequest(
  routeId: string,
  data: z.infer<typeof requestBodySchema>,
  acl: AuthACL[] = []
) {
  const projectIds = acl.map((a) => a.projectId);
  const exist = await routeExist(routeId, projectIds);
  if (!exist) {
    throw new NotFoundError("Route not found");
  }
  const deleteBlockIds: string[] = [];
  const deleteEdgeIds: string[] = [];
  for (const change of data.actionsToPerform.blocks) {
    if (change.action === "delete") deleteBlockIds.push(change.id);
  }
  for (const change of data.actionsToPerform.edges) {
    if (change.action === "delete") deleteEdgeIds.push(change.id);
  }
  const blocksToUpsert = data.changes.blocks.map((block) => ({
    ...block,
    routeId: routeId,
  }));
  const edgesToUpsert = data.changes.edges.map((edge) => ({
    ...edge,
    routeId: routeId,
  }));
  const result = await db.transaction(async (tx) => {
    if (blocksToUpsert.length > 0) await upsertBlocks(blocksToUpsert, tx);
    if (edgesToUpsert.length > 0) await insertEdges(edgesToUpsert, tx);
    if (deleteBlockIds.length > 0) await deleteBlocks(deleteBlockIds, tx);
    if (deleteEdgeIds.length > 0) await deleteEdges(deleteEdgeIds, tx);
    const duplicateBlocks = await getBlocksCountByType(routeId, [BlockTypes.entrypoint, BlockTypes.errorHandler], tx);
    for (const dupBlock of duplicateBlocks) {
      if (dupBlock.count !== 1) {
        tx.rollback();
        throw new BadRequestError(`Duplicate block ${dupBlock.type} found`);
      }
    }
    return true;
  });
  if (!result) throw new ServerError("Something went wrong");
  await publishMessage(CHAN_ON_ROUTE_CHANGE, routeId);
}
