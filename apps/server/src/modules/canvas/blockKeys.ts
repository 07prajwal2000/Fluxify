import type { DbTransactionType } from "../../db";
import { getBlocks, reserveBlockKeys } from "./repository";
import type { CanvasParent } from "./types";

/**
 * The key of every block a save writes: a block already on the canvas keeps
 * its own, a new one gets the next number of its type. A client never chooses
 * or changes a key, so none of this is read from the request.
 */
export async function assignBlockKeys(
	parent: CanvasParent,
	blocks: { id: string; type: string }[],
	tx: DbTransactionType,
) {
	const stored = new Map((await getBlocks(parent, tx)).map((b) => [b.id, b.key]));
	const created = blocks.filter((b) => !stored.has(b.id));
	const keys = await reserveBlockKeys(
		parent,
		created.map((b) => b.type),
		tx,
	);
	const newKeys = Object.fromEntries(created.map((b, i) => [b.id, keys[i]]));
	return { keyOf: (id: string) => stored.get(id) ?? newKeys[id], newKeys };
}
