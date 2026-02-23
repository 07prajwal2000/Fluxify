import { GraphNode } from "@langchain/langgraph";
import { withRetry } from "../../agentRetry";
import { AgentStateSchema } from "../state";
import { BuilderOutputSchema } from "../schemas";
import { blockAiDescriptions, contextVarsAiDescription } from "@fluxify/blocks";
import { YAML } from "bun";
import { searchDocsTool, readDocsContentTool } from "../tools/docs";

export const BUILDER_NODE_ID = "builder";

export const BuilderNode: GraphNode<typeof AgentStateSchema> = async (
  state,
) => {
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
  model.bindTools([searchDocsTool, readDocsContentTool]);
  const blockSchemasJson = YAML.stringify(
    blockAiDescriptions.filter((desc) =>
      state.buildMode?.plannerOutput?.plannedBlockNames?.includes(desc.name),
    ),
  );

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
   - For modification to existing blocks, use the same ID and update the data and connections.
   - For JavaScript expressions, use the following syntax: js:expression. Search docs for more info about js expressions. Previous block's output is available in \`input\` global variable.

6. **Tools**: If you are unsure how to configure a specific block's schema or need to know more about blocks, execution, about the api builder, or using javascript, use the '${searchDocsTool.name}' and '${readDocsContentTool.name}' tools to find documentation before outputting.
</construction_rules>

<output_format>
Output valid JSON ONLY. No markdown fences.
{
  "reasoning": "string", // your reasoning will be used as messages history in future. so make it concise and clear.
  "status": "success | impossible",
  "clarificationQuestion": "string | null",
  "blocks": [
    {
      "id": "block_1",
      "blockType": "if_condition",
      "data": { ... },
      "position": { "x": 0, "y": 150 },
      "connections": [
        { "blockId": "block_2", "handle": "success" }, // example: success handle is connected to block for further execution
        { "blockId": "block_3", "handle": "failure" } // example: failure handle is connected to output the error
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
  }
  return state;
};
