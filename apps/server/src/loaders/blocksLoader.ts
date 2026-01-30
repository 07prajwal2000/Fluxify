import { BlockBuilder, BlockTypes, Context, Engine } from "@fluxify/blocks";
import { db } from "../db";
import { blocksEntity, edgesEntity } from "../db/schema";
import { and, eq, ne } from "drizzle-orm";
import { getCache, hasCacheKey, setCache } from "../db/redis";

export async function startBlocksExecution(routeId: string, context: Context) {
  const builder = new BlockBuilder(context, {
    create(builder, executor) {
      return new Engine(builder.buildGraph(executor), {
        errorHandlerId: builder.getErrorHandlerId(),
        maxExecutionTimeInMs: 4 * 1000,
        context: context
      });
    },
  });

  // Load blocks and edges from database
  const { blocks, edges } = await loadBlocksAndEdgesFromDatabase(routeId);
  builder.loadBlocks(blocks);
  builder.loadEdges(edges);
  const entrypoint = builder.getEntrypoint();
  const graph = builder.buildGraph(entrypoint);
  const engine = new Engine(graph, {
    errorHandlerId: builder.getErrorHandlerId(),
    maxExecutionTimeInMs: 4 * 1000,
    context: context
  });
  const executionResult = await engine.start(entrypoint, context.requestBody);
  return executionResult;
}

async function loadBlocksAndEdgesFromDatabase(routeId: string) {
  const cacheKey = `${routeId}_GRAPH`;
  if (await hasCacheKey(cacheKey)) {
    return JSON.parse(await getCache(cacheKey));
  }
  const blocks = await loadBlocksFromDB(routeId);
  const edges = await loadEdgesFromDB(routeId);
  await setCache(cacheKey, JSON.stringify({ blocks, edges }));

  return {
    blocks,
    edges,
  };
}

async function loadBlocksFromDB(routeId: string) {
  // Load blocks for the route
  const blocksResult = await db
    .select()
    .from(blocksEntity)
    .where(
      and(
        eq(blocksEntity.routeId, routeId),
        ne(blocksEntity.type, BlockTypes.sticky_note)
      )
    );

  // Filter out blocks with null types and ensure proper typing
  const blocks = blocksResult
    .filter((block) => block.type !== null)
    .map((block) => ({
      id: block.id,
      type: block.type as any, // BlockTypes will be handled by the BlockBuilder
      position: block.position as { x: number; y: number },
      data: block.data,
    }));
  return blocks;
}

async function loadEdgesFromDB(routeId: string) {
  const edgesResult = await db
    .select({
      id: edgesEntity.id,
      from: edgesEntity.from,
      to: edgesEntity.to,
      fromHandle: edgesEntity.fromHandle,
      toHandle: edgesEntity.toHandle,
    })
    .from(edgesEntity)
    .where(eq(edgesEntity.routeId, routeId));

  // Filter out edges with null values and ensure proper typing
  const edges = edgesResult.map((edge) => ({
    id: edge.id as string,
    from: edge.from as string,
    to: edge.to as string,
    fromHandle: edge.toHandle as string,
    toHandle: edge.fromHandle as string,
  }));
  return edges;
}
