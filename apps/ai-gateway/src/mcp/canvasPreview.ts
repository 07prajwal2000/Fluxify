import { z } from "zod";
import type { AdminApi } from "./adminApi";
import { nameBlocks } from "./canvasNames";
import { type CanvasItems, canvasAfterChanges } from "./canvasNormalize";
import { type CanvasOp, opsToChanges } from "./canvasOps";
import { BASE, canvasTools, read, type Target } from "./canvasTools";
import { lenient, type McpTool } from "./tools";

/** A canvas as the preview shows it: every block named by key, edges by endpoint. */
export type CanvasView = {
	blocks: {
		id: string;
		key: string;
		type: string;
		data: unknown;
		position: { x: number; y: number };
	}[];
	edges: { id: string; from: string; to: string; handle: string }[];
};

export type EditPreview = {
	/** The version the ops were checked against: the one edit_canvas must be given. */
	version: number;
	before: CanvasView;
	/** The canvas once the ops are applied; missing when an op was refused. */
	after?: CanvasView;
	/** One line per thing the ops do, as edit_canvas reports them. */
	changes?: string[];
	/** Rule issues a save would report. */
	issues?: { severity: string; message: string; block?: string }[];
	/** Why edit_canvas would refuse these ops, in keys. */
	error?: string;
};

/** The handle on an edge, bare: `if_1`'s `<id>-success` is `success`. */
const handleOf = (e: CanvasItems["edges"][number]) => {
	const h = e.fromHandle ?? "";
	return h.startsWith(`${e.from}-`) ? h.slice(e.from.length + 1) : h;
};

const view = (canvas: CanvasItems, keyOf: (id: string) => string): CanvasView => ({
	blocks: canvas.blocks.map((b) => ({
		id: b.id,
		key: keyOf(b.id),
		type: b.type,
		data: b.data,
		position: b.position,
	})),
	edges: canvas.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, handle: handleOf(e) })),
});

/**
 * What `edit_canvas` would do to the canvas as it is now, without saving.
 *
 * It runs the same steps as the tool: `opsToChanges` turns the ops into the
 * save diff, then the server checks that diff in a dry run (it rolls back, and
 * names the blocks the save would add). The "after" canvas is the diff applied
 * in memory, so the preview cannot drift from what a save does.
 */
export async function previewEdit(
	api: AdminApi,
	target: Target,
	ops: CanvasOp[],
	autoLayout?: boolean,
): Promise<EditPreview> {
	const canvas = await read(api.get, target);
	const stored = nameBlocks(canvas);
	const before = view(canvas, stored.name);
	const version = canvas.canvasVersion as number;
	let planned: ReturnType<typeof opsToChanges>;
	try {
		planned = opsToChanges(canvas, ops, autoLayout);
	} catch (error) {
		return { version, before, error: (error as Error).message };
	}
	const { changes, refs, describe } = planned;
	const path = `${BASE[target.kind]}/${target.id}/save-canvas?expectedVersion=${version}&dryRun=true`;
	const dry = await api.send("PUT", path, changes).catch((error: Error) => error);
	const failed = dry instanceof Error;
	const { name, keyed } = nameBlocks(canvas, refs, failed ? {} : dry.newKeys);
	const after = view(canvasAfterChanges(canvas, changes), name);
	return {
		version,
		before,
		after,
		changes: describe(name),
		...(failed
			? { error: keyed(dry.message) }
			: {
					issues: (dry.issues ?? []).map(
						({ blockId, message, ...rest }: { blockId?: string; message: string }) => ({
							...rest,
							message: keyed(message),
							...(blockId ? { block: name(blockId) } : {}),
						}),
					),
				}),
	};
}

const edit = canvasTools.find((t) => t.name === "edit_canvas") as McpTool;
/** What the preview takes: edit_canvas's own target and ops, checked the same way, no version. */
export const previewInput = z.object(
	lenient({ target: edit.input.target, ops: edit.input.ops, auto_layout: edit.input.auto_layout }),
);
