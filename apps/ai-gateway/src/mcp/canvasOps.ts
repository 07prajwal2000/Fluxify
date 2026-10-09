import { layoutGraph } from "@fluxify/blocks/layout";
import { z } from "zod";
import { bare, Draft, edgeText, STRUCTURAL } from "./canvasDraft";
import {
	type BlockBuilderPayload,
	type CanvasChanges,
	type CanvasItems,
	canonicalType,
	canvasAfterChanges,
	canvasChangesFromPayload,
} from "./canvasNormalize";

export { resolveHandle } from "./canvasDraft";

/**
 * `edit_canvas` ops → the server's save-canvas diff.
 *
 * Ops are checked against the canvas first, so a bad op is refused with a
 * reason instead of being dropped. The diff itself is built by
 * `canvasChangesFromPayload` (refs → ids, handle ids, type names).
 *
 * Blocks are named by key (`response_1`) everywhere the agent sees them; the
 * ids stay on the server and in the diff.
 */

const blockRef = z
	.string()
	.describe('A block key from get_canvas ("response_1"), or a ref added earlier in this call');
const handle = z
	.string()
	.optional()
	.describe(
		"Output handle on the from block: source, success, failure, executor, orchestrate or case. Omit for the block's default.",
	);
const position = z.object({ x: z.number(), y: z.number() });

export const canvasOpSchema = z.discriminatedUnion("op", [
	z.object({
		op: z.literal("add_block"),
		ref: z
			.string()
			.describe(
				'Your name for the new block in this call, e.g. "block_1". Later ops and connect use it; the result gives the key the server assigned.',
			),
		type: z.string().describe("Block type from get_block_schemas, or a custom block's name"),
		data: z.record(z.string(), z.unknown()).optional().describe("The block's settings"),
		position: position.optional().describe("Omit and the server places it"),
		connect_from: z
			.object({ from: blockRef, handle })
			.optional()
			.describe("Also connect this block after another one"),
	}),
	z.object({
		op: z.literal("update_block"),
		id: blockRef,
		data: z
			.record(z.string(), z.unknown())
			.describe("Only the fields that change; merged into the block's data"),
	}),
	z.object({ op: z.literal("remove_block"), id: blockRef.describe("Block key; its edges go too") }),
	z.object({ op: z.literal("connect"), from: blockRef, to: blockRef, handle }),
	z.object({ op: z.literal("disconnect"), from: blockRef, to: blockRef, handle }),
]);

export type CanvasOp = z.infer<typeof canvasOpSchema>;

type Block = CanvasItems["blocks"][number];
type Edge = CanvasItems["edges"][number];

/** One line of what an op did, written once every block has its key. */
export type Echo = (name: (blockOrRef: string) => string) => string;

type Declared = NonNullable<BlockBuilderPayload["blocks"]>[number];

/**
 * Checks the ops against `canvas` and turns them into a save diff. Throws a
 * readable error on the first bad op; nothing is saved then.
 *
 * `refs` maps each add_block ref to the id it was given; `describe` says what
 * the ops did, once `name` can say each block's key.
 */
export function opsToChanges(canvas: CanvasItems, ops: CanvasOp[], autoLayout = false) {
	const draft = new Draft(canvas);
	const stored = new Map(canvas.blocks.map((b) => [b.id, b]));
	const declared = new Map<string, Declared>();
	const deletedEdges = new Set<string>();
	const placed = new Set<string>();
	const echo: Echo[] = [];

	/** a stored block restated so it can carry data or connections */
	const declare = (id: string) => {
		let d = declared.get(id);
		if (!d) {
			const b = stored.get(id) as Block;
			d = {
				id,
				blockType: b.type,
				data: { ...(b.data as object) },
				position: b.position,
				connections: [],
			};
			declared.set(id, d);
		}
		return d;
	};
	const connect = (from: string, to: string, h?: string) => {
		const kind = draft.connect(from, to, h);
		declare(from).connections!.push({ blockId: to, handle: kind });
		const type = draft.get(from).type;
		echo.push((n) => `connected ${edgeText(n(from), type, kind, n(to))}`);
	};

	for (const op of ops) {
		switch (op.op) {
			case "add_block": {
				if (draft.taken(op.ref)) {
					throw new Error(
						`add_block: "${op.ref}" is already a block key, id or ref. Pick a new ref.`,
					);
				}
				const type = canonicalType(op.type);
				if (STRUCTURAL.has(type))
					throw new Error(`add_block: a canvas already has its one ${type} block.`);
				draft.addNew(op.ref, type);
				declared.set(op.ref, {
					id: op.ref,
					blockType: type,
					data: op.data ?? {},
					position: op.position,
					connections: [],
				});
				if (op.position) placed.add(op.ref);
				echo.push((n) => `added ${n(op.ref)} (${op.ref})`);
				if (op.connect_from) {
					const from = draft.endpoint(op.connect_from.from, op.connect_from.handle, "add_block");
					connect(from.id, op.ref, from.handle);
				}
				break;
			}
			case "update_block": {
				const id = draft.resolve(op.id, "update_block");
				const d = declared.get(id) ?? declare(id);
				d.data = { ...(d.data ?? {}), ...op.data };
				echo.push((n) => `updated ${n(id)} (${Object.keys(op.data).join(", ") || "no fields"})`);
				break;
			}
			case "remove_block": {
				const id = draft.resolve(op.id, "remove_block");
				const { ids, count } = draft.remove(id);
				for (const edge of ids) deletedEdges.add(edge);
				declared.delete(id);
				for (const d of declared.values()) {
					d.connections = d.connections?.filter((c) => c.blockId !== id);
				}
				echo.push(
					(n) => `removed ${n(id)}${count ? ` (+${count} edge${count > 1 ? "s" : ""})` : ""}`,
				);
				break;
			}
			case "connect": {
				const from = draft.endpoint(op.from, op.handle, "connect");
				connect(from.id, draft.resolve(op.to, "connect"), from.handle);
				break;
			}
			case "disconnect": {
				const from = draft.endpoint(op.from, op.handle, "disconnect");
				const to = draft.resolve(op.to, "disconnect");
				const { ids, handles } = draft.disconnect(from.id, to, from.handle);
				for (const id of ids) deletedEdges.add(id);
				const d = declared.get(from.id);
				if (d) d.connections = d.connections?.filter((c) => c.blockId !== to);
				const type = draft.get(from.id).type;
				for (const h of handles) {
					echo.push((n) => `disconnected ${edgeText(n(from.id), type, h, n(to))}`);
				}
				break;
			}
		}
	}

	const changes = canvasChangesFromPayload(
		{
			blocks: [...declared.values()],
			canvasChanges: draft.removed.size
				? [{ type: "block_remove", data: { blocks: [...draft.removed] } }]
				: [],
		},
		canvas,
	);
	// `canvasChangesFromPayload` keeps edges a connect re-declares; drop the ones
	// this call disconnected or that hung off a removed block
	const upserted = new Set(changes.changes.edges.map((e) => e.id));
	for (const id of deletedEdges) {
		if (!upserted.has(id)) changes.actionsToPerform.edges.push({ id, action: "delete" });
	}
	changes.actionsToPerform.edges = dedupe(changes.actionsToPerform.edges);

	// blocks come back in the order they were declared, refs swapped for new ids
	const refs: Record<string, string> = {};
	const unplaced: string[] = [];
	[...declared.keys()].forEach((ref, i) => {
		if (!draft.blocks.get(ref)?.isNew) return;
		const id = changes.changes.blocks[i].id;
		refs[ref] = id;
		if (!placed.has(ref)) unplaced.push(id);
	});
	place(changes, canvas, unplaced, autoLayout);
	if (autoLayout) echo.push(() => "laid out every block again");
	const describe = (name: (blockOrRef: string) => string) => echo.map((line) => line(name));
	return { changes, refs, describe };
}

const dedupe = <T extends { id: string }>(items: T[]) => [
	...new Map(items.map((i) => [i.id, i])).values(),
];

/**
 * Positions: a new block without one is placed by the layout; `autoLayout`
 * re-lays out every block. Blocks already on the canvas otherwise stay put.
 */
function place(
	changes: CanvasChanges,
	canvas: CanvasItems,
	unplaced: string[],
	autoLayout: boolean,
) {
	if (!autoLayout && unplaced.length === 0) return;
	const after = canvasAfterChanges(canvas, changes);
	const moved = layoutGraph(after.blocks, after.edges, { changedIds: unplaced });
	const byId = new Map(changes.changes.blocks.map((b) => [b.id, b]));
	const ids = autoLayout ? Object.keys(moved) : unplaced;
	for (const id of ids) {
		const position = moved[id];
		if (!position) continue;
		const block = byId.get(id);
		if (block) {
			block.position = position;
			continue;
		}
		// a stored block that only moves still needs its type and data restated
		const b = canvas.blocks.find((s) => s.id === id)!;
		changes.changes.blocks.push({ id, type: b.type, data: b.data, position });
		changes.actionsToPerform.blocks.push({ id, action: "upsert" });
	}
}

/**
 * What get_canvas returns: what the blocks do and how they connect, no UI
 * data. Blocks and edges are named by key, never by id.
 */
export function trimCanvas(canvas: CanvasItems & { canvasVersion: number }) {
	const key = new Map(canvas.blocks.map((b) => [b.id, b.key ?? b.id]));
	const type = new Map(canvas.blocks.map((b) => [b.id, b.type]));
	return {
		version: canvas.canvasVersion,
		blocks: canvas.blocks.map((b: Block) => ({ key: b.key ?? b.id, type: b.type, data: b.data })),
		edges: canvas.edges.map((e: Edge) =>
			edgeText(
				key.get(e.from) ?? e.from,
				type.get(e.from) ?? "",
				bare(e.from, e.fromHandle ?? "source"),
				key.get(e.to) ?? e.to,
			),
		),
	};
}
