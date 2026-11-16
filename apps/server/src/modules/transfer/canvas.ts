import { generateID } from "@fluxify/lib";
import { z } from "zod";
import type { DbTransactionType } from "../../db";
import { getBlocks, getEdges } from "../canvas/repository";
import { saveCanvas } from "../canvas/service";
import { canvasBlockSchema, canvasEdgeSchema } from "../canvas/types";

export const bundleCanvasSchema = z.object({
	blocks: z.array(canvasBlockSchema),
	edges: z.array(canvasEdgeSchema),
});

export type BundleCanvas = z.infer<typeof bundleCanvasSchema>;
export type CanvasParent = { type: "route" | "workflow"; id: string };

export async function readBundleCanvas(parent: CanvasParent): Promise<BundleCanvas> {
	const [blocks, edges] = await Promise.all([getBlocks(parent), getEdges(parent)]);
	return {
		blocks: blocks.map((b) => ({
			id: b.id,
			type: b.type!,
			data: b.data,
			position: (b.position as { x: number; y: number }) ?? { x: 0, y: 0 },
		})),
		edges: edges.map((e) => ({
			id: e.id,
			from: e.from!,
			to: e.to!,
			fromHandle: e.fromHandle,
			toHandle: e.toHandle,
		})),
	};
}

/**
 * Saves the bundle's canvas onto `parent` under fresh ids. Returns old block id →
 * new block id, which the suites' hooks need.
 */
export async function writeBundleCanvas(
	parent: CanvasParent,
	canvas: BundleCanvas,
	projectId: string,
	tx: DbTransactionType,
): Promise<Map<string, string>> {
	// fresh ids: block and edge ids are unique across every canvas
	const blockIds = new Map(canvas.blocks.map((b) => [b.id, generateID()]));
	const newId = (id: string) => blockIds.get(id) ?? id;

	const blocks = canvas.blocks.map((b) => ({ ...b, id: newId(b.id) }));
	// edge ids are remapped too: the ids of the source canvas are still taken
	const edges = canvas.edges.map((e) => ({
		...e,
		id: generateID(),
		from: newId(e.from),
		to: newId(e.to),
		fromHandle: e.fromHandle?.replaceAll(e.from, newId(e.from)),
		toHandle: e.toHandle?.replaceAll(e.to, newId(e.to)),
	}));
	await saveCanvas(
		parent,
		{
			actionsToPerform: {
				blocks: blocks.map((b) => ({ id: b.id, action: "upsert" as const })),
				edges: edges.map((e) => ({ id: e.id, action: "upsert" as const })),
			},
			changes: { blocks, edges },
		},
		[projectId],
		tx,
		false,
		{ foreignIntegrations: true },
	);
	return blockIds;
}
