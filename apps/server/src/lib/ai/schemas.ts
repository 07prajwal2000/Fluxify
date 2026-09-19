import z from "zod";

/**
 * Valid intents for the AI classifier.
 */
export const ClassificationIntentSchema = z
	.enum(["DISCUSSION", "BUILD"])
	.describe("The primary intent behind the user's message.");

export type ClassificationIntent = z.infer<typeof ClassificationIntentSchema>;

/**
 * Output schema for the Classifier node.
 */
export const ClassifierOutputSchema = z.object({
	intent: ClassificationIntentSchema.describe("Determined action path for the agent."),
	reasoning: z.string().describe("Short explanation of why this intent was chosen."),
});

/**
 * Output schema for the Planner node.
 */
export const PlannerOutputSchema = z.object({
	status: z.enum(["success", "vague", "impossible"]).describe("Feasibility status of the request."),
	reasoning: z.string().describe("Architectural reasoning for the plan."),
	clarificationQuestion: z
		.string()
		.nullable()
		.describe("Question to ask the user if the status is not 'success'."),
	plannedBlockNames: z
		.array(z.string())
		.default([])
		.describe("List of block types to be used in construction."),
});

/**
 * Valid handle types for block connections.
 */
export const HandleTypeSchema = z
	.enum(["source", "executor", "failure", "success", "orchestrate", "case"])
	.describe("Types of output handles available on blocks.");

/**
 * Schema for a connection between two blocks.
 */
// ─── Connection Schema ───────────────────────────────────────────────

export const ConnectionSchema = z.object({
	blockId: z.string().describe("Target block ID to connect to."),
	handle: HandleTypeSchema.describe("Specific output handle of the source block."),
});

// ─── Block Schema ────────────────────────────────────────────────────

export const BlockSchema = z.object({
	id: z.string().describe("Unique identifier for the block."),
	blockType: z.string().describe("The type/category of the block (e.g., 'http_request')."),
	blockName: z.string().optional().describe("Human-readable name for the block instance."),
	blockDescription: z
		.string()
		.optional()
		.describe("Brief description of what this block instance does."),
	data: z.any().optional().describe("Configuration payload specific to the block type."),
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

// ─── Canvas Change Schema ────────────────────────────────────────────

export const CanvasChangeSchema = z
	.object({
		type: z.literal("edge_swap").describe("Re-route an existing connection."),
		data: z.object({
			fromEdge: z.string().describe("Source block ID of the edge being changed."),
			fromHandle: z
				.string()
				.describe("Handle on the source block (e.g., 'source', 'success', 'failure')."),
			toEdge: z.string().describe("New target block ID."),
			toHandle: z.string().describe("Handle on the new target block."),
		}),
	})
	.or(
		z.object({
			type: z.literal("block_remove").describe("Delete one or more blocks from the canvas."),
			data: z.object({
				blocks: z.array(z.string()).describe("Array of block IDs to remove from the canvas."),
				reason: z.string().describe("Short explanation for why the blocks are being removed."),
			}),
		}),
	)
	.or(
		z.object({
			type: z.literal("block_change").describe("Modify existing blocks in-place."),
			data: z.object({
				blocksInfo: z
					.array(BlockSchema)
					.describe(
						"Array of existing block objects with updated data, using their current IDs from the canvas.",
					),
			}),
		}),
	);

// ─── Builder Output Schema ───────────────────────────────────────────

export const BuilderOutputSchema = z.object({
	reasoning: z.string().describe("Explanation of the construction strategy."),
	status: z.enum(["success", "impossible"]).describe("Whether the flow was successfully built."),
	clarificationQuestion: z.string().nullable().describe("Feedback if construction failed."),
	canvasChanges: z
		.array(CanvasChangeSchema)
		.optional()
		.describe(
			"Mutations to existing items on the canvas (edge re-routing, block removal, or in-place block updates). Only used when the canvas is non-empty.",
		),
	blocks: z.array(BlockSchema).describe("New block configurations to add to the canvas."),
});

/**
 * Output schema for the Discussion node.
 */
export const DiscussionOutputSchema = z.object({
	output: z.string().describe("The response message for the user."),
	redirect: z
		.boolean()
		.describe("Whether to switch context to the builder (e.g., if user asks to build)."),
});

export const ToolsContextSchema = z.object({
	toolCalls: z.set(z.string()).default(new Set()),
});

export type ToolsContext = z.infer<typeof ToolsContextSchema>;
