import { BlockTypes } from "@fluxify/blocks";
import { BadRequestError } from "../../../../errors/badRequestError";

type Block = {
	id: string;
	key: string | null;
	type: string | null;
	data: unknown;
	position: unknown;
};
type Edge = {
	id: string;
	from: string | null;
	to: string | null;
	fromHandle: string | null;
	toHandle: string | null;
};

const STRUCTURAL = new Set<string>([BlockTypes.entrypoint, BlockTypes.errorHandler]);
const isNote = (b: Block) => b.type === BlockTypes.sticky_note;
const tidy =
	"Tidy the selection so it has one entry block and no stray connections, then try again.";

/**
 * What an extraction moves, and the only shapes it accepts: one entry block fed
 * by at most one outside edge, and at most one edge leaving from the single
 * last block. Anything messier is refused with a message that says how to clean
 * it up, so the new custom block never inherits a tangle.
 */
export function planExtraction(blocks: Block[], edges: Edge[], keys: string[]) {
	if (keys.length === 0) throw new BadRequestError("Select at least one block to extract.");
	const byKey = new Map(blocks.map((b) => [b.key, b]));
	const unknown = keys.filter((k) => !byKey.has(k));
	if (unknown.length) throw new BadRequestError(`No block ${unknown.join(", ")} on that canvas.`);

	const picked = [...new Set(keys)].map((k) => byKey.get(k) as Block);
	const structural = picked.filter((b) => STRUCTURAL.has(b.type ?? ""));
	if (structural.length)
		throw new BadRequestError(
			`${structural.map((b) => b.key).join(", ")} can't be extracted: the entrypoint and error handler stay on the canvas.`,
		);

	const ids = new Set(picked.map((b) => b.id));
	const flow = picked.filter((b) => !isNote(b));
	if (flow.length === 0)
		throw new BadRequestError("Select at least one block besides sticky notes to extract.");

	const inner = edges.filter((e) => ids.has(e.from ?? "") && ids.has(e.to ?? ""));
	const incoming = edges.filter((e) => !ids.has(e.from ?? "") && ids.has(e.to ?? ""));
	const outgoing = edges.filter((e) => ids.has(e.from ?? "") && !ids.has(e.to ?? ""));

	const heads = flow.filter((b) => !inner.some((e) => e.to === b.id));
	if (heads.length !== 1)
		throw new BadRequestError(
			`The selection has ${heads.length} entry blocks (${heads.map((b) => b.key).join(", ")}). ${tidy}`,
		);
	const [head] = heads;
	if (incoming.length > 1 || incoming.some((e) => e.to !== head.id))
		throw new BadRequestError(
			`Connections from outside must be one edge into ${head.key}. ${tidy}`,
		);

	const sinks = flow.filter((b) => !inner.some((e) => e.from === b.id));
	const stray = outgoing.filter((e) => !sinks.some((b) => b.id === e.from));
	if (stray.length || outgoing.length > 1 || (sinks.length > 1 && outgoing.length))
		throw new BadRequestError(
			`Connections leaving the selection must be one edge from its single last block. ${tidy}`,
		);

	return { picked, inner, head, incoming: incoming[0], outgoing: outgoing[0] };
}
