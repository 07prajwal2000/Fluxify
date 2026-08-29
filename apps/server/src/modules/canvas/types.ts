import { z } from "zod";

/**
 * The one canvas contract. A route canvas, a custom block canvas and a workflow
 * canvas are the same graph — blocks with positions, edges with handles — so
 * they share this schema, the storage behind it, and the service that mutates
 * it. Adding a parent is a value here plus a row in `parentTables`.
 */
export const canvasParentTypeSchema = z.enum([
	"route",
	"custom_block",
	"workflow",
]);
export type CanvasParentType = z.infer<typeof canvasParentTypeSchema>;

export type CanvasParent = { type: CanvasParentType; id: string };

const changeSchema = z.object({
	id: z.string(),
	// action is just for reference, but all blocks/edges are checked against for
	// deletions. create/update do the upsert operation on IDs
	action: z.enum(["upsert", "delete"]),
});

export const canvasBlockSchema = z.object({
	id: z.string(),
	type: z.string(),
	data: z.any(),
	position: z.object({ x: z.number(), y: z.number() }),
});

export const canvasEdgeSchema = z.object({
	id: z.string(),
	from: z.string(),
	to: z.string(),
	fromHandle: z.string().nullable().optional(),
	toHandle: z.string().nullable().optional(),
});

/** the request body both save-canvas endpoints (and the ops bus) accept */
export const canvasChangesSchema = z.object({
	actionsToPerform: z.object({
		blocks: z.array(changeSchema),
		edges: z.array(changeSchema),
	}),
	changes: z.object({
		blocks: z.array(canvasBlockSchema),
		edges: z.array(canvasEdgeSchema),
	}),
});

export type CanvasChanges = z.infer<typeof canvasChangesSchema>;

/** what get-canvas-items returns, for either parent */
export const canvasItemsSchema = z.object({
	blocks: z.array(canvasBlockSchema),
	edges: z.array(
		z.object({
			id: z.string(),
			from: z.string(),
			to: z.string(),
			fromHandle: z.string(),
			toHandle: z.string(),
		}),
	),
});
