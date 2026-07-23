import { z } from "zod";

export const HandleTypeSchema = z
	.enum(["source", "executor", "failure", "success"])
	.describe("Types of output handles available on blocks.");

export const ConnectionSchema = z.object({
	blockId: z.string().describe("Target block ID to connect to."),
	handle: HandleTypeSchema.describe(
		"Specific output handle of the source block.",
	),
});

export const BlockSchema = z.object({
	id: z.string().describe("Unique identifier for the block."),
	blockType: z
		.string()
		.describe("The type/category of the block (e.g., 'http_request')."),
	blockName: z
		.string()
		.optional()
		.describe("Human-readable name for the block instance."),
	blockDescription: z
		.string()
		.optional()
		.describe("Brief description of what this block instance does."),
	data: z
		.record(z.string(), z.unknown())
		.optional()
		.describe("Configuration payload specific to the block type."),
	position: z
		.object({
			x: z.number().describe("Horizontal coordinate on the canvas."),
			y: z.number().describe("Vertical coordinate on the canvas."),
		})
		.describe("Visual position of the block."),
	connections: z
		.array(ConnectionSchema)
		.describe("List of downstream connections from this block."),
});

export const CanvasChangeSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("edge_swap").describe("Re-route an existing connection."),
		data: z.object({
			fromEdge: z
				.string()
				.describe("Source block ID of the edge being changed."),
			fromHandle: z
				.string()
				.describe(
					"Handle on the source block (e.g., 'source', 'success', 'failure').",
				),
			toEdge: z.string().describe("New target block ID."),
			toHandle: z.string().describe("Handle on the new target block."),
		}),
	}),
	z.object({
		type: z
			.literal("block_remove")
			.describe("Delete one or more blocks from the canvas."),
		data: z.object({
			blocks: z
				.array(z.string())
				.describe("Array of block IDs to remove from the canvas."),
			reason: z
				.string()
				.describe("Short explanation for why the blocks are being removed."),
		}),
	}),
	z.object({
		type: z
			.literal("block_change")
			.describe("Modify existing blocks in-place."),
		data: z.object({
			blocksInfo: z
				.array(BlockSchema)
				.describe(
					"Array of existing block objects with updated data, using their current IDs from the canvas.",
				),
		}),
	}),
]);

export const blockBuilderSchema = z.object({
	reasoning: z
		.string()
		.optional()
		.describe(
			"Provide a short reasoning ONLY when status is 'impossible' to explain why construction is impossible. Do not provide reasoning when status is 'success'.",
		),
	status: z.enum(["success", "impossible"]),
	targetType: z
		.enum(["route", "custom_block"])
		.describe("Whether this canvas belongs to a route or custom block"),
	targetId: z
		.string()
		.describe("The ID of the route or custom block this canvas belongs to"),
	canvasChanges: z
		.array(CanvasChangeSchema)
		.describe("List of changes for existing canvas items"),
	blocks: z.array(BlockSchema).describe("New blocks to add to the canvas"),
});

export type BlockBuilderResult = z.infer<typeof blockBuilderSchema>;
export type ValidatableBlock = {
	id: string;
	blockType: string;
	data?: Record<string, unknown>;
	connections?: Array<{ blockId: string; handle?: string }>;
};
