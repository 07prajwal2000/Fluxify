import { logger } from "@fluxify/common";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { CHAN_ON_CUSTOM_BLOCK_CHANGE, subscribeToChannel } from "../db/redis";
import { customBlocksListEntity } from "../db/schema";

export const customBlockNames = new Set<string>();
/** id -> name, so a single-block delete knows which name to drop */
const blockNameById = new Map<string, string>();

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
		})
		.from(customBlocksListEntity);

	rebuildCache(blocks);
}

async function loadSingleCustomBlock(id: string) {
	const blocks = await db
		.select({
			id: customBlocksListEntity.id,
			name: customBlocksListEntity.name,
		})
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.id, id));

	if (blocks.length === 0) {
		// Block was deleted
		const name = blockNameById.get(id);
		if (name) {
			customBlockNames.delete(name);
			blockNameById.delete(id);
		}
		return;
	}

	rebuildCache(blocks, true);
}

type DbBlock = { id: string; name: string };

function rebuildCache(blocks: DbBlock[], isSingle: boolean = false) {
	if (!isSingle) {
		customBlockNames.clear();
		blockNameById.clear();
	}

	for (const block of blocks) {
		customBlockNames.add(block.name);
		blockNameById.set(block.id, block.name);
	}
}

export function initializeCustomBlocksSubscription() {
	subscribeToChannel(CHAN_ON_CUSTOM_BLOCK_CHANGE, async (id) => {
		logger.info(`Custom block reloaded: ${id || "all"}`);
		await loadCustomBlocks(id);
	});
}
