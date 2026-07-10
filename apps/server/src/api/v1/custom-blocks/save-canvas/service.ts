import z from "zod";
import { requestBodySchema } from "./dto";
import { NotFoundError } from "../../../../errors/notFoundError";
import { AuthACL } from "../../../../db/schema";
import { canAccess } from "../../../../lib/acl";
import {
  upsertGraphs,
  deleteGraphs,
  setUpdatedAtTimeForCustomBlock,
  customBlockExist,
} from "./repository";
import { getCustomBlockGraphs } from "../get-canvas-items/repository";
import { db } from "../../../../db";
import { publishMessage, CHAN_ON_CUSTOM_BLOCK_CHANGE } from "../../../../db/redis";

export default async function handleRequest(
  customBlockId: string,
  data: z.infer<typeof requestBodySchema>,
  acl: AuthACL[],
) {
  const projectIds = acl
    .filter((a) => canAccess(a.role, "creator"))
    .map((a) => a.projectId);
    
  const exist = await customBlockExist(customBlockId, projectIds);
  if (!exist) {
    throw new NotFoundError("Custom Block not found");
  }

  // Strategy: Load all current blocks, apply changes, save back.
  const currentGraphs = await getCustomBlockGraphs(customBlockId);
  const blocksMap = new Map<string, any>();
  
  for (const graph of currentGraphs) {
    blocksMap.set(graph.id, graph);
  }

  const blocksToDelete = new Set<string>();
  const edgesToDelete = new Set<string>();

  data.actionsToPerform.blocks.forEach((action) => {
    if (action.action === "delete") {
      blocksToDelete.add(action.id);
      blocksMap.delete(action.id);
    }
  });

  data.actionsToPerform.edges.forEach((action) => {
    if (action.action === "delete") edgesToDelete.add(action.id);
  });

  // Apply block upserts
  data.changes.blocks.forEach((block) => {
    blocksMap.set(block.id, {
      id: block.id,
      type: block.type,
      data: { ...block.data, position: block.position },
      customBlockId,
    });
  });

  // Reconstruct connections
  const allEdges = new Map<string, any>();
  for (const [id, block] of blocksMap.entries()) {
    const conns = block.data?.connections || [];
    for (const conn of conns) {
      if (!edgesToDelete.has(conn.id)) {
        allEdges.set(conn.id, { ...conn, from: id });
      }
    }
    block.data = { ...block.data, connections: [] };
  }

  // Apply upserted edges
  data.changes.edges.forEach((edge) => {
    allEdges.set(edge.id, edge);
  });

  // Distribute edges back to blocks
  for (const edge of allEdges.values()) {
    const block = blocksMap.get(edge.from);
    if (block) {
      block.data.connections.push({
        id: edge.id,
        to: edge.to,
        fromHandle: edge.fromHandle,
        toHandle: edge.toHandle,
      });
    }
  }

  // Format for insertion
  const blocksToInsert = Array.from(blocksMap.values()).map((b) => ({
    id: b.id,
    type: b.type,
    data: b.data,
    customBlockId,
  }));

  await db.transaction(async (tx) => {
    if (blocksToDelete.size > 0) {
      await deleteGraphs(Array.from(blocksToDelete), tx);
    }
    if (blocksToInsert.length > 0) {
      await upsertGraphs(blocksToInsert, tx);
    }
    await setUpdatedAtTimeForCustomBlock(customBlockId, tx);
  });
  
  await publishMessage(CHAN_ON_CUSTOM_BLOCK_CHANGE, customBlockId);
}
