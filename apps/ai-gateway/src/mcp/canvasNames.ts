import { bare, edgeText } from "./canvasDraft";
import type { CanvasItems } from "./canvasNormalize";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * What to call things in an answer. The server speaks in ids; the agent only
 * ever sees keys. Covers the blocks on the canvas, the blocks this call added
 * (`refs`: ref → id, `newKeys`: id → the key the server gave it) and the
 * canvas's edges, which the server names by id in its errors.
 */
export function nameBlocks(
	canvas: CanvasItems,
	refs: Record<string, string> = {},
	newKeys: Record<string, string> = {},
) {
	const names = new Map(canvas.blocks.map((b) => [b.id, b.key ?? b.id]));
	const types = new Map(canvas.blocks.map((b) => [b.id, b.type]));
	for (const e of canvas.edges) {
		const handle = bare(e.from, e.fromHandle ?? "source");
		const [from, to] = [names.get(e.from) ?? e.from, names.get(e.to) ?? e.to];
		names.set(e.id, edgeText(from, types.get(e.from) ?? "", handle, to));
	}
	/** ref → the key the server assigned */
	const keys: Record<string, string> = {};
	for (const [ref, id] of Object.entries(refs)) {
		keys[ref] = newKeys[id] ?? ref;
		names.set(ref, keys[ref]);
		names.set(id, keys[ref]);
	}
	const name = (idOrRef: string) => names.get(idOrRef) ?? idOrRef;
	/** a message with any block or edge id in it swapped for its key */
	const keyed = (text: string) => text.replace(UUID, (id) => name(id));
	return { name, keys, keyed };
}
