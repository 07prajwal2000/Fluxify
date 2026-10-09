import type { CanvasView } from "@fluxify/ai-gateway/src/mcp/canvasPreview";
import { type Data, isRec, rec, same, str } from "./data";

export type FieldChange = { field: string; before?: unknown; after?: unknown };
export type BlockStatus = "same" | "added" | "removed" | "changed";
export type DiffBlock = {
	/** What the agent calls it (`response_1`); also this diff's id for the block. */
	key: string;
	type: string;
	status: BlockStatus;
	/** Where the block sits; missing when the diff comes from ops alone. */
	position?: { x: number; y: number };
	data: Data;
	changes: FieldChange[];
};
export type DiffEdge = {
	id: string;
	from: string;
	to: string;
	handle: string;
	status: "same" | "added" | "removed";
};
export type CanvasDiff = { blocks: DiffBlock[]; edges: DiffEdge[] };

/** What differs between two block data records, field by field. */
export function fieldChanges(before: Data, after: Data): FieldChange[] {
	const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
	return [...fields]
		.filter((f) => !same(before[f], after[f]))
		.map((field) => ({
			field,
			...(field in before && { before: before[field] }),
			...(field in after && { after: after[field] }),
		}));
}

/** All of a record as added (or removed) fields. */
const whole = (data: Data, side: "before" | "after"): FieldChange[] =>
	Object.entries(data).map(([field, v]) => ({ field, [side]: v }));

/** Two canvases (blocks by key, edges by id) as one picture of what changed. */
export function diffCanvases(before: CanvasView, after: CanvasView): CanvasDiff {
	const was = new Map(before.blocks.map((b) => [b.id, b]));
	const now = new Map(after.blocks.map((b) => [b.id, b]));
	const blocks: DiffBlock[] = after.blocks.map((b) => {
		const old = was.get(b.id);
		const data = rec(b.data);
		const base = { key: b.key, type: b.type, position: b.position, data };
		if (!old) return { ...base, status: "added", changes: whole(data, "after") };
		const changes = fieldChanges(rec(old.data), data);
		return { ...base, status: changes.length ? "changed" : "same", changes };
	});
	for (const b of before.blocks)
		if (!now.has(b.id))
			blocks.push({
				key: b.key,
				type: b.type,
				status: "removed",
				position: b.position,
				data: rec(b.data),
				changes: whole(rec(b.data), "before"),
			});
	const keyOf = new Map([...before.blocks, ...after.blocks].map((b) => [b.id, b.key]));
	const edge = (e: CanvasView["edges"][number], status: DiffEdge["status"]): DiffEdge => ({
		id: e.id,
		from: keyOf.get(e.from) ?? e.from,
		to: keyOf.get(e.to) ?? e.to,
		handle: e.handle,
		status,
	});
	const had = new Set(before.edges.map((e) => e.id));
	const has = new Set(after.edges.map((e) => e.id));
	return {
		blocks,
		edges: [
			...after.edges.map((e) => edge(e, had.has(e.id) ? "same" : "added")),
			...before.edges.filter((e) => !has.has(e.id)).map((e) => edge(e, "removed")),
		],
	};
}

/** `response_1` → `response`: the block type a key is made of, for a block only named in an op. */
const typeOfKey = (key: string) => key.replace(/_\d+$/, "");

/**
 * What an applied edit_canvas did, from its ops alone: the canvas it changed is
 * not kept, so this is the touched blocks and the edges between them, not the
 * whole canvas. `refs` (from the result) names the blocks the edit added.
 */
export function diffFromOps(ops: unknown[], refs: Record<string, string> = {}): CanvasDiff {
	const blocks = new Map<string, DiffBlock>();
	const edges: DiffEdge[] = [];
	const name = (ref: unknown) => refs[str(ref)] ?? str(ref);
	/** A block an op only points at, with nothing known about it. */
	const touch = (key: string) => {
		if (!blocks.has(key))
			blocks.set(key, { key, type: typeOfKey(key), status: "same", data: {}, changes: [] });
		return blocks.get(key) as DiffBlock;
	};
	const connect = (op: Data, status: DiffEdge["status"]) => {
		const [from, dotted] = str(op.from).split(".");
		const handle = str(op.handle) || dotted || "source";
		const [a, b] = [name(from), name(op.to)];
		touch(a);
		touch(b);
		edges.push({ id: `${status}:${a}.${handle}>${b}`, from: a, to: b, handle, status });
	};
	for (const raw of ops) {
		const op = rec(raw);
		switch (op.op) {
			case "add_block": {
				const key = name(op.ref);
				const data = rec(op.data);
				blocks.set(key, {
					key,
					type: str(op.type),
					status: "added",
					data,
					changes: whole(data, "after"),
				});
				if (isRec(op.connect_from))
					connect(
						{ from: op.connect_from.from, to: op.ref, handle: op.connect_from.handle },
						"added",
					);
				break;
			}
			case "update_block": {
				const b = touch(name(op.id));
				b.status = b.status === "added" ? "added" : "changed";
				b.changes.push(...whole(rec(op.data), "after"));
				break;
			}
			case "edit_code": {
				const b = touch(name(op.id));
				b.status = b.status === "added" ? "added" : "changed";
				b.changes.push({
					field: str(op.field) || "code",
					before: str(op.old),
					after: str(op.new),
				});
				break;
			}
			case "remove_block":
				touch(name(op.id)).status = "removed";
				break;
			case "connect":
				connect(op, "added");
				break;
			case "disconnect":
				connect(op, "removed");
				break;
		}
	}
	return { blocks: [...blocks.values()], edges };
}

export const countBy = (diff: CanvasDiff) => ({
	added: diff.blocks.filter((b) => b.status === "added").length,
	removed: diff.blocks.filter((b) => b.status === "removed").length,
	changed: diff.blocks.filter((b) => b.status === "changed").length,
});
