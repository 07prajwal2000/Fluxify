import { getOutputHandles } from "@fluxify/blocks/blockHandles";
import { blockKeyPrefix, blockKeyPrefixOf } from "@fluxify/blocks/blockKeys";
import { BlockTypes } from "@fluxify/blocks/blockTypes";
import type { CanvasItems } from "./canvasNormalize";

/** Blocks the runtime enters itself; nothing may point at them, and they stay. */
export const STRUCTURAL = new Set<string>([BlockTypes.entrypoint, BlockTypes.errorHandler]);
const FAN_OUT = new Set(["orchestrate", "case"]);

export const bare = (from: string, h: string) =>
	h.startsWith(`${from}-`) ? h.slice(from.length + 1) : h;

/** "if_1.success → db_insert_1"; the handle is left out for a block with only one. */
export const edgeText = (from: string, type: string, handle: string, to: string) =>
	`${from}${getOutputHandles(type).length > 1 ? `.${handle}` : ""} → ${to}`;

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

/**
 * The canvas as the ops see it while they are checked one by one.
 *
 * Blocks are told apart by id inside, but the agent names them by key
 * (`response_1`) or, for a block added in the same call, by the ref it chose.
 * A stored block's id still works for clients that read it elsewhere.
 */
export class Draft {
	blocks = new Map<string, { type: string; isNew: boolean }>();
	/** edges as from|handle|to, stored ones carrying their id */
	edges = new Map<string, { from: string; handle: string; to: string; id?: string }>();
	removed = new Set<string>();
	/** stored key → id */
	private byKey = new Map<string, string>();
	private goneKeys = new Set<string>();
	/** what to call a block in a message: its key, or the ref it was added under */
	private labels = new Map<string, string>();

	constructor(canvas: CanvasItems) {
		for (const b of canvas.blocks) {
			const key = b.key ?? b.id;
			this.blocks.set(b.id, { type: b.type, isNew: false });
			this.byKey.set(key, b.id);
			this.labels.set(b.id, key);
		}
		for (const e of canvas.edges) {
			const h = bare(e.from, e.fromHandle ?? "source");
			this.edges.set(`${e.from}|${h}|${e.to}`, { from: e.from, handle: h, to: e.to, id: e.id });
		}
	}

	name(id: string) {
		return this.labels.get(id) ?? id;
	}

	/** is this already a key, an id or a ref of this call? */
	taken(ref: string) {
		return (
			this.blocks.has(ref) || this.byKey.has(ref) || this.removed.has(ref) || this.goneKeys.has(ref)
		);
	}

	addNew(ref: string, type: string) {
		this.blocks.set(ref, { type, isNew: true });
		this.labels.set(ref, ref);
	}

	/** A key, an id or a ref added earlier in this call → the block's id. */
	resolve(raw: string, op: string) {
		const ref = raw.trim();
		const id = this.blocks.has(ref) ? ref : this.byKey.get(ref);
		if (id) {
			this.assertType(ref, id, op);
			return id;
		}
		if (this.removed.has(ref) || this.goneKeys.has(ref))
			throw new Error(`${op}: block ${ref} was removed earlier in this call.`);
		throw new Error(
			`${op}: no block "${ref}". ${this.similar(ref)} Use a key from get_canvas or a ref added earlier in this call.`,
		);
	}

	/** "if_1.success" → the block and its handle; the handle may also come as its own field */
	endpoint(raw: string, given: string | undefined, op: string) {
		const dot = raw.lastIndexOf(".");
		if (dot < 0 || this.blocks.has(raw.trim()) || this.byKey.has(raw.trim()))
			return { id: this.resolve(raw, op), handle: given };
		const handle = raw.slice(dot + 1);
		if (given && given.trim() !== handle)
			throw new Error(`${op}: "${raw}" names the ${handle} handle but handle is ${given}.`);
		return { id: this.resolve(raw.slice(0, dot), op), handle };
	}

	/** A key names its block's type. A hand-typed or stale one that disagrees is refused. */
	private assertType(ref: string, id: string, op: string) {
		const block = this.blocks.get(id)!;
		const wanted = blockKeyPrefixOf(ref);
		if (ref === id || block.isNew || !wanted || wanted === blockKeyPrefix(block.type)) return;
		throw new Error(`${op}: ${ref} is a ${block.type} block, not a ${wanted} block.`);
	}

	private similar(ref: string) {
		const keys = [...this.byKey.keys()];
		const stem = (k: string) => blockKeyPrefixOf(k) ?? k;
		const wanted = blockKeyPrefixOf(ref) ?? ref;
		const near = keys.filter((k) => stem(k).includes(wanted) || wanted.includes(stem(k)));
		return `${near.length ? "Similar keys" : "Keys"}: ${(near.length ? near : keys).slice(0, 12).join(", ")}.`;
	}

	/** the handle the edge is stored on */
	connect(from: string, to: string, given?: string) {
		const source = this.get(from);
		const target = this.get(to);
		if (STRUCTURAL.has(target.type))
			throw new Error(`connect: nothing may point at the ${target.type} block.`);
		if (from === to) throw new Error("connect: a block cannot connect to itself.");
		const h = resolveHandle(source.type, this.name(from), given);
		const taken = [...this.edges.values()].find((e) => e.from === from && e.handle === h);
		if (taken && taken.to !== to && !FAN_OUT.has(h)) {
			throw new Error(
				`connect: ${this.name(from)}'s ${h} handle already goes to ${this.name(taken.to)}. Disconnect it first, in the same call.`,
			);
		}
		this.edges.set(`${from}|${h}|${to}`, { from, handle: h, to });
		return h;
	}

	/** the edges this disconnect drops: their stored ids, and each one's handle */
	disconnect(from: string, to: string, given?: string) {
		const h = given ? bare(from, given) : undefined;
		const hits = [...this.edges.entries()].filter(
			([, e]) => e.from === from && e.to === to && (!h || e.handle === h),
		);
		if (!hits.length) {
			const have = [...this.edges.values()]
				.filter((e) => e.from === from)
				.map((e) => `${e.handle} -> ${this.name(e.to)}`);
			throw new Error(
				`disconnect: no edge from ${this.name(from)} to ${this.name(to)}${h ? ` on ${h}` : ""}. ${this.name(from)} has ${have.length ? `edges ${have.join(", ")}` : "no outgoing edges"}.`,
			);
		}
		for (const [key] of hits) this.edges.delete(key);
		return {
			ids: hits.flatMap(([, e]) => (e.id ? [e.id] : [])),
			handles: hits.map(([, e]) => e.handle),
		};
	}

	/** the stored edge ids that went with the block, and how many edges that was in all */
	remove(id: string) {
		const b = this.get(id);
		if (b.isNew)
			throw new Error(`remove_block: ${this.name(id)} was added in this call; just leave it out.`);
		if (STRUCTURAL.has(b.type))
			throw new Error(`remove_block: the ${b.type} block cannot be removed.`);
		this.blocks.delete(id);
		this.removed.add(id);
		this.goneKeys.add(this.name(id));
		this.byKey.delete(this.name(id));
		const dropped: string[] = [];
		let count = 0;
		for (const [key, e] of this.edges) {
			if (e.from !== id && e.to !== id) continue;
			this.edges.delete(key);
			count++;
			if (e.id) dropped.push(e.id);
		}
		return { ids: dropped, count };
	}

	get(id: string) {
		return this.blocks.get(id)!;
	}
}
