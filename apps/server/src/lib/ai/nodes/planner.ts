import { GraphNode } from "@langchain/langgraph";
import { withRetry } from "../../agentRetry";
import { AgentStateSchema } from "../state";
import z from "zod";
import { blockAiDescriptions } from "@fluxify/blocks";

export const PLANNER_NODE_ID = "planner";

const plannerSchema = z.object({
  status: z.enum(["success", "vague", "impossible"]),
  reasoning: z.string(),
  clarificationQuestion: z.string().optional(),
  plannedBlockIds: z.array(z.string()).default([]),
  plannedIntegrationIds: z.array(z.string()).default([]),
  plannedConfigIds: z.array(z.string()).default([]),
});

const blockListStr = blockAiDescriptions
  .map((b) => `- ${b.name}: ${b.description}`)
  .join("\n");

export const PlannerNode: GraphNode<typeof AgentStateSchema> = async (
  state,
) => {
  const { userPrompt, messages, modelFactory, metadata } = state;
  const integrationListStr = metadata.integrationsList
    .map((i) => `- ${i.id} | ${i.name}`)
    .join("\n");
  const appConfigListStr = metadata.configsList
    .map((c) => `- ${c.name} | ${c.description}`)
    .join("\n");
  const model = modelFactory.createModel();
  const result = await withRetry(
    async (history) => {
      const response = await model.invoke(history);
      return response.content.toString();
    },
    plannerSchema,
    [
      ...messages,
      [
        "system",
        `You are Fluxi, the Planner Agent for a Low-Code API builder.

<task>
Analyze the user's request and map it to available resources.
</task>

<available_resources>
<blocks>
  name | description
 ${blockListStr}
</blocks>

<integrations>
  id | name
 ${integrationListStr}
</integrations>

<configs>
  name | description
 ${appConfigListStr}
</configs>
</available_resources>

<rules>
1. Output valid JSON ONLY. No markdown fences.
2. If resources are missing: status="impossible".
3. If request is ambiguous: status="vague" AND provide a clarificationQuestion.
4. If feasible: status="success".
5. Strictly use the IDs for integrations and names for blocks and configs provided in resources above. Do not invent new IDs.
</rules>

<output_format>
{
  "status": "success | vague | impossible",
  "reasoning": "string",
  "clarificationQuestion": "string | null",
  "plannedBlockIds": ["string"],
  "plannedIntegrationIds": ["string"],
  "plannedConfigIds": ["string"]
}
</output_format>
`,
      ],
      ["human", userPrompt],
    ],
  );
  if (result) {
    state.buildMode = { plannerOutput: result };
  }
  return state;
};
