import { blockAiDescriptions, contextVarsAiDescription } from "@fluxify/blocks";
import type { GraphNode } from "@langchain/langgraph";
import { YAML } from "bun";
import { withRetry } from "../../agentRetry";
import { BuilderOutputSchema } from "../schemas";
import type { AgentStateSchema } from "../state";

export const BUILDER_NODE_ID = "builder";

export const BuilderNode: GraphNode<typeof AgentStateSchema> = async (state) => {
	const { userPrompt, messages, modelFactory, metadata } = state;
	const emptyIntegrationListStr = "No integrations available.";
	const integrationListStr = metadata.integrationsList
		.map((i) => `- ${i.id} | ${i.name} | ${i.group} | ${i.variant}`)
		.join("\n");
	const emptyConfigListStr = "No configs available.";
	const appConfigListStr = metadata.configsList
		.map((c) => `- ${c.name} | ${c.description}`)
		.join("\n");
	const model = modelFactory.createModel();
	const blockSchemasJson = YAML.stringify(
		blockAiDescriptions.filter((desc) =>
			state.buildMode?.plannerOutput?.plannedBlockNames?.includes(desc.name),
		),
	);

	await state.tracker?.update(3, "started", "Builder");
	const result = await withRetry(
		async (history) => {
			const response = await model.invoke(history);
			return response.content.toString();
		},
		BuilderOutputSchema,
		[
			...messages,
			[
				"system",
				`You are Fluxi, the Builder Agent for a Low-Code API builder. You construct the final JSON configuration for the API flow.
        
<available_resources>
<global_context>
Route Metadata:
- Name: ${state.metadata.route.name}
- Method: ${state.metadata.route.method}
- Path: ${state.metadata.route.path}
</global_context>

<current_canvas_state>
${JSON.stringify(state.metadata.route.canvasItems)}
</current_canvas_state>

<planned_blocks>
The user wants to add the following types of blocks:
-${state.buildMode?.plannerOutput?.plannedBlockNames?.join("\n-")}
</planned_blocks>

<block_schemas>
Here are the construction blueprints for the available blocks:
${blockSchemasJson}
</block_schemas>

<integrations>
ID | Name | Group | Variant
 ${integrationListStr || emptyIntegrationListStr}
</integrations>

<configs>
Name | Description
 ${appConfigListStr || emptyConfigListStr}
</configs>
${contextVarsAiDescription}
</available_resources>

<construction_rules>
1. **Immutable Blocks**: 
   - NEVER create or delete 'entrypoint' or 'error_handler' blocks.
   - Use the IDs from <current_canvas_state> to connect to them if they exist.
   - If the canvas is empty, assume the entrypoint exists implicitly (ID: 'entrypoint').

2. **IDs**: 
   - Generate simple string IDs (e.g., 'block_1', 'block_2') for NEW blocks.
   - DO NOT generate UUIDs.
   - Use the ID for integrations (or Connections for integrating with 3rd party services/tools).
   - Use the Name for configs.

3. **Positioning**:
   - Block size is 50x50 units.
   - Layout flows Top -> Bottom.
   - Vertical spacing: 100 units.
   - Horizontal spacing (if branching or any handle types other than 'source'): 100 units.
   - Start new nodes below the lowest existing node in the canvas.

4. **Connections**:
   - Use the 'connections' array to define edges.
   - Standard blocks use handle type: 'source'.
   - Control blocks (If, ForLoop, Transaction, ForEach) use handle types: 'success', 'failure', 'executor'.
   - Connect new blocks to the existing canvas logic.

5. **Data Filling**:
   - Strictly adhere to the JSON Schema provided in <block_schemas>.
   - Use Route Metadata to fill path/method variables.
   - Use available Integrations/Configs for authentication fields.
   - For JavaScript expressions, use the following syntax: js:expression. Search docs for more info about js expressions. Previous block's output is available in 'input' global variable.

6. **Canvas Modifications (canvasChanges)**:
   When modifying an existing canvas (non-empty <current_canvas_state>), use the 'canvasChanges' array to express changes to **existing** items. Each entry must have a 'type' and a 'data' object.

   - **'edge_swap'**: Re-route an existing connection from one handle/block to another.
     - 'fromEdge': The source block ID of the edge being changed.
     - 'fromHandle': The handle on the source block (e.g., 'source', 'success', 'failure').
     - 'toEdge': The new target block ID.
     - 'toHandle': The handle on the new target block.
   - **'block_remove'**: Delete one or more blocks (and their associated edges) from the canvas.
     - 'blocks': Array of block IDs to remove.
     - 'reason': A short explanation for why the blocks are being removed.
     - NEVER remove 'entrypoint' or 'error_handler' blocks.
   - **'block_change'**: Modify the data or connections of existing blocks **in-place**.
     - 'blocksInfo': An array of block objects (same schema as entries in 'blocks' — id, blockType, data, position, connections) using the **existing** block IDs from <current_canvas_state>.

   > **Important**: Only use 'canvasChanges' for mutations to items already on the canvas. Brand-new blocks always go in the top-level 'blocks' array.

7. **Tools**: If you are unsure how to configure a specific block's schema or need to know more about blocks, execution, about the api builder, or using javascript, consult the block schemas and documentation provided above.
</construction_rules>

<output_format>
Output valid JSON ONLY. No markdown fences.
{
  "reasoning": "string", // your reasoning will be used as messages history in future. so make it concise and clear.
  "status": "success | impossible",
  "clarificationQuestion": "string | null",
  "canvasChanges": [
    // Example: re-route an edge
    {
      "type": "edge_swap",
      "data": {
        "fromEdge": "existing_block_A",
        "fromHandle": "success",
        "toEdge": "block_1",
        "toHandle": "source"
      }
    },
    // Example: remove blocks that are no longer needed
    {
      "type": "block_remove",
      "data": {
        "blocks": ["old_block_1", "old_block_2"],
        "reason": "Replaced by new validation logic"
      }
    },
    // Example: update config/data of an existing block in-place
    {
      "type": "block_change",
      "data": {
        "blocksInfo": [
          {
            "id": "existing_block_B",
            "blockType": "response",
            "data": { ... },
            "position": { "x": 0, "y": 300 },
            "connections": []
          }
        ]
      }
    }
  ],
  "blocks": [
    {
      "id": "block_1",
      "blockType": "if_condition",
      "data": { ... },
      "position": { "x": 0, "y": 150 },
      "connections": [
        { "blockId": "block_2", "handle": "success" },
        { "blockId": "block_3", "handle": "failure" }
      ]
    },
    {
      "id": "block_2",
      "blockType": "for_loop",
      "data": { ... },
      "position": { "x": 50, "y": 200 },
      "connections": []
    },
    {
      "id": "block_3",
      "blockType": "response",
      "data": { ... },
      "position": { "x": -50, "y": 200 },
      "connections": []
    }
  ]
}
</output_format>`,
			],
			["human", userPrompt],
		],
	);
	if (result) {
		state.buildMode!.builderOutput = result;
		await state.tracker?.update(3, "success", "Builder", {
			builderOutput: result,
		});
	}
	return state;
};
