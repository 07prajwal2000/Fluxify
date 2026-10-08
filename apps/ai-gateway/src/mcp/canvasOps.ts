import { getOutputHandles } from "@fluxify/blocks/blockHandles";
import { BlockTypes } from "@fluxify/blocks/blockTypes";
import { layoutGraph } from "@fluxify/blocks/layout";
import { z } from "zod";
import {
	type BlockBuilderPayload,
	type CanvasChanges,
	type CanvasItems,
	canonicalType,
	canvasAfterChanges,
	canvasChangesFromPayload,
} from "../api/v1/harness-conversations/artifacts/normalize";

/**
 * `edit_canvas` ops → the server's save-canvas diff.
 *
 * Ops are checked against the canvas first, so a bad op is refused with a
 * reason instead of being dropped. The diff itself is built by the harness's
 * `canvasChangesFromPayload` (refs → ids, handle ids, type names), so MCP and
 * the harness write a canvas the same way.
 */

const blockId = z
	.string()
	.describe('A block id from get_canvas, or a ref added earlier in this call ("block_1")');
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
			.describe('Your name for the new block, e.g. "block_1". Later ops and connect use it.'),
		type: z.string().describe("Block type from get_block_schemas, or a custom block's name"),
		data: z.record(z.string(), z.unknown()).optional().describe("The block's settings"),
		position: position.optional().describe("Omit and the server places it"),
		connect_from: z
			.object({ from: blockId, handle })
			.optional()
			.describe("Also connect this block after another one"),
	}),
	z.object({
		op: z.literal("update_block"),
		id: blockId,
		data: z
			.record(z.string(), z.unknown())
			.describe("Only the fields that change; merged into the block's data"),
	}),
	z.object({ op: z.literal("remove_block"), id: blockId.describe("Block id; its edges go too") }),
	z.object({ op: z.literal("connect"), from: blockId, to: blockId, handle }),
	z.object({ op: z.literal("disconnect"), from: blockId, to: blockId, handle }),
]);

export type CanvasOp = z.infer<typeof canvasOpSchema>;

type Block = CanvasItems["blocks"][number];
type Edge = CanvasItems["edges"][number];

/** Blocks the runtime enters itself; nothing may point at them, and they stay. */
const STRUCTURAL = new Set<string>([BlockTypes.entrypoint, BlockTypes.errorHandler]);
const FAN_OUT = new Set(["orchestrate", "case"]);

const bare = (from: string, h: string) => (h.startsWith(`${from}-`) ? h.slice(from.length + 1) : h);

/** The handle a connect uses: the one given, or the from block's default. */
export function resolveHandle(type: string, from: string, given?: string) {
	const handles = getOutputHandles(type);
	if (given) {
		const h = bare(from, given.trim());
		if (!handles.includes(h)) {
			throw new Error(
				`${type} block ${from} has no "${h}" handle. Use ${handles.join(", ") || "none: it ends the flow"}.`,
			);
		}
		return h;
	}
	if (handles.includes("source")) return "source";
	if (handles.length === 1) return handles[0];
	if (handles.length === 0)
		throw new Error(`${type} block ${from} ends the flow: it has no output handle.`);
	throw new Error(
		`${type} block ${from} has several handles: pass handle as one of ${handles.join(", ")}.`,
	);
}

/** The canvas as the ops see it while they are checked one by one. */
class Draft {
	blocks = new Map<string, { type: string; isNew: boolean }>();
	/** edges as from|handle|to, stored ones carrying their id */
	edges = new Map<string, { from: string; handle: string; to: string; id?: string }>();
	removed = new Set<string>();

	constructor(canvas: CanvasItems) {
		for (const b of canvas.blocks) this.blocks.set(b.id, { type: b.type, isNew: false });
		for (const e of canvas.edges) {
			const h = bare(e.from, e.fromHandle ?? "source");
			this.edges.set(`${e.from}|${h}|${e.to}`, { from: e.from, handle: h, to: e.to, id: e.id });
		}
	}

	block(id: string, op: string) {
		const b = this.blocks.get(id);
		if (!b) {
			throw new Error(
				this.removed.has(id)
					? `${op}: block ${id} was removed earlier in this call.`
					: `${op}: no block "${id}". Use an id from get_canvas or a ref added earlier in this call.`,
			);
		}
		return b;
	}

	connect(from: string, to: string, given?: string) {
		const source = this.block(from, "connect");
		const target = this.block(to, "connect");
		if (STRUCTURAL.has(target.type))
			throw new Error(`connect: nothing may point at the ${target.type} block.`);
		if (from === to) throw new Error("connect: a block cannot connect to itself.");
		const h = resolveHandle(source.type, from, given);
		const taken = [...this.edges.values()].find((e) => e.from === from && e.handle === h);
		if (taken && taken.to !== to && !FAN_OUT.has(h)) {
			throw new Error(
				`connect: ${from}'s ${h} handle already goes to ${taken.to}. Disconnect it first, in the same call.`,
			);
		}
		this.edges.set(`${from}|${h}|${to}`, { from, handle: h, to });
		return h;
	}

	/** stored edge ids this disconnect drops */
	disconnect(from: string, to: string, given?: string) {
		const h = given ? bare(from, given) : undefined;
		const hits = [...this.edges.entries()].filter(
			([, e]) => e.from === from && e.to === to && (!h || e.handle === h),
		);
		if (!hits.length) {
			const have = [...this.edges.values()]
				.filter((e) => e.from === from)
				.map((e) => `${e.handle} -> ${e.to}`);
			throw new Error(
				`disconnect: no edge from ${from} to ${to}${h ? ` on ${h}` : ""}. ${from} has ${have.length ? `edges ${have.join(", ")}` : "no outgoing edges"}.`,
			);
		}
		for (const [key] of hits) this.edges.delete(key);
		return hits.flatMap(([, e]) => (e.id ? [e.id] : []));
	}

	remove(id: string) {
		const b = this.block(id, "remove_block");
		if (b.isNew) throw new Error(`remove_block: ${id} was added in this call; just leave it out.`);
		if (STRUCTURAL.has(b.type))
			throw new Error(`remove_block: the ${b.type} block cannot be removed.`);
		this.blocks.delete(id);
		this.removed.add(id);
		const dropped: string[] = [];
		for (const [key, e] of this.edges) {
			if (e.from !== id && e.to !== id) continue;
			this.edges.delete(key);
			if (e.id) dropped.push(e.id);
		}
		return dropped;
	}
}

type Declared = NonNullable<BlockBuilderPayload["blocks"]>[number];

/**
 * Checks the ops against `canvas` and turns them into a save diff. Throws a
 * readable error on the first bad op; nothing is saved then.
 *
 * `refs` maps each add_block ref to the id it was given.
 */
export function opsToChanges(canvas: CanvasItems, ops: CanvasOp[], autoLayout = false) {
	const draft = new Draft(canvas);
	const stored = new Map(canvas.blocks.map((b) => [b.id, b]));
	const declared = new Map<string, Declared>();
	const deletedEdges = new Set<string>();
	const placed = new Set<string>();

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
	};

	for (const op of ops) {
		switch (op.op) {
			case "add_block": {
				if (draft.blocks.has(op.ref) || draft.removed.has(op.ref)) {
					throw new Error(`add_block: "${op.ref}" is already a block id or ref. Pick a new ref.`);
				}
				const type = canonicalType(op.type);
				if (STRUCTURAL.has(type))
					throw new Error(`add_block: a canvas already has its one ${type} block.`);
				draft.blocks.set(op.ref, { type, isNew: true });
				declared.set(op.ref, {
					id: op.ref,
					blockType: type,
					data: op.data ?? {},
					position: op.position,
					connections: [],
				});
				if (op.position) placed.add(op.ref);
				if (op.connect_from) connect(op.connect_from.from, op.ref, op.connect_from.handle);
				break;
			}
			case "update_block": {
				draft.block(op.id, "update_block");
				const d = declared.get(op.id) ?? declare(op.id);
				d.data = { ...(d.data ?? {}), ...op.data };
				break;
			}
			case "remove_block":
				for (const id of draft.remove(op.id)) deletedEdges.add(id);
				declared.delete(op.id);
				for (const d of declared.values()) {
					d.connections = d.connections?.filter((c) => c.blockId !== op.id);
				}
				break;
			case "connect":
				connect(op.from, op.to, op.handle);
				break;
			case "disconnect": {
				for (const id of draft.disconnect(op.from, op.to, op.handle)) deletedEdges.add(id);
				const d = declared.get(op.from);
				if (d) d.connections = d.connections?.filter((c) => c.blockId !== op.to);
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
	return { changes, refs };
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

/** What get_canvas returns: what the blocks do and how they connect, no UI data. */
export function trimCanvas(canvas: CanvasItems & { canvasVersion: number }) {
	return {
		version: canvas.canvasVersion,
		blocks: canvas.blocks.map((b: Block) => ({ id: b.id, type: b.type, data: b.data })),
		edges: canvas.edges.map((e: Edge) => ({
			from: e.from,
			to: e.to,
			handle: bare(e.from, e.fromHandle ?? "source"),
		})),
	};
}
