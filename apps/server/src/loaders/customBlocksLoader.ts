import { db } from "../db";
import { customBlocksListEntity } from "../db/schema";
import { CHAN_ON_CUSTOM_BLOCK_CHANGE, subscribeToChannel } from "../db/redis";
import { logger } from "@fluxify/common";
import { eq } from "drizzle-orm";
import { getGraphsWithConnections } from "../modules/canvas/repository";

export type CustomBlockGraphCache = {
  id: string;
  type: string | null;
  data: Record<string, unknown>;
};

export type CustomBlockCache = {
  id: string;
  name: string;
  inputParams: Record<string, unknown>[] | null;
  graphs: CustomBlockGraphCache[];
};

export let customBlocksCache: Record<string, CustomBlockCache> = {};
export let customBlockNames = new Set<string>();

export async function loadCustomBlocks(id?: string) {
  try {
    if (id) {
      await loadSingleCustomBlock(id);
    } else {
      await loadAllCustomBlocks();
    }
  } catch (error) {
    logger.error(`Failed to load custom blocks: ${error}`);
  }
}

async function loadAllCustomBlocks() {
  const blocks = await db
    .select({
      id: customBlocksListEntity.id,
      name: customBlocksListEntity.name,
      inputParams: customBlocksListEntity.inputParams,
    })
    .from(customBlocksListEntity);
    
  if (blocks.length === 0) {
    customBlocksCache = {};
    return;
  }

  const graphs = await getGraphsWithConnections(
    "custom_block",
    blocks.map((b) => b.id),
  );

  rebuildCache(blocks, graphs);
}

async function loadSingleCustomBlock(id: string) {
  const blocks = await db
    .select({
      id: customBlocksListEntity.id,
      name: customBlocksListEntity.name,
      inputParams: customBlocksListEntity.inputParams,
    })
    .from(customBlocksListEntity)
    .where(eq(customBlocksListEntity.id, id));

  if (blocks.length === 0) {
    // Block was deleted
    if (customBlocksCache[id]) {
      customBlockNames.delete(customBlocksCache[id].name);
      delete customBlocksCache[id];
    }
    return;
  }

  const graphs = await getGraphsWithConnections("custom_block", [id]);

  rebuildCache(blocks, graphs, true);
}

type DbBlock = { id: string; name: string; inputParams: Record<string, unknown>[] | null };
type DbGraph = { id: string; parentId: string | null; type: string | null; data: any };

function rebuildCache(blocks: DbBlock[], graphs: DbGraph[], isSingle: boolean = false) {
  if (!isSingle) {
    customBlocksCache = {};
    customBlockNames.clear();
  }

  // Group graphs by customBlockId
  const graphsByBlockId: Record<string, CustomBlockGraphCache[]> = {};
  for (const graph of graphs) {
    if (!graph.parentId) continue;
    if (!graphsByBlockId[graph.parentId]) {
      graphsByBlockId[graph.parentId] = [];
    }

    // Omit UI specific properties (position, image, etc.)
    const { position, image, iconUrl, ...restData } = graph.data || {};

    graphsByBlockId[graph.parentId].push({
      id: graph.id,
      type: graph.type,
      data: restData,
    });
  }

  for (const block of blocks) {
    customBlockNames.add(block.name);
    customBlocksCache[block.id] = {
      ...block,
      graphs: graphsByBlockId[block.id] || [],
    };
  }
}

export function initializeCustomBlocksSubscription() {
  subscribeToChannel(CHAN_ON_CUSTOM_BLOCK_CHANGE, async (id) => {
    logger.info(`Custom block reloaded: ${id || "all"}`);
    await loadCustomBlocks(id);
  });
}
