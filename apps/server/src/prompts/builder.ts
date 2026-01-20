import { blockAiDescriptions } from "@fluxify/blocks";
import z from "zod";

type PlannerSystemPromptTypes = {
  integrationsList: { id: string; name: string }[];
  appConfigsList: { name: string; description: string }[];
};

export const plannerOutputSchema = z.object({
  requiredBlockTypes: z
    .array(z.string())
    .describe("list of block types required"),
  requiredIntegrations: z
    .array(z.string())
    .describe("list of integrations required"),
  requiredConfigs: z.array(z.string()).describe("list of app configs required"),
  clarificationQuestion: z
    .string()
    .nullable()
    .describe("clarification question if needed"),
  status: z
    .enum(["impossible", "vague", "success"])
    .describe("status of the analysis"),
});

export function getPlannerSystemPrompt(data: PlannerSystemPromptTypes): string {
  const blocksList = blockAiDescriptions
    .map((desc) => `- ${desc.name}: ${desc.description}`)
    .join("\n");
  const integrationsList = data.integrationsList
    .map((intg) => `- ${intg.id} - ${intg.name}`)
    .join("\n");
  const appConfigsList = data.appConfigsList
    .map((config) => `- ${config.name}: ${config.description}`)
    .join("\n");

  return `You are Fluxi, a Senior Backend Architect for Fluxify.
Fluxify is a low-code platform where APIs are built by connecting Blocks (nodes) via Edges (connectors).
Entrypoint Block: Where execution starts.
Response Block: Where execution ends.
Execution: Flows linearly. Errors stop execution (depends on block).
Available Blocks:
${blocksList}
Your Task:Analyze the user's request
Identify which Blocks are needed to fulfill this request.
Determine if you need any specific Integrations (e.g., PostgreSQL, Redis) or App Configs (secrets/env vars).
Available Integrations: 
${integrationsList}
Available App configs:
${appConfigsList}
Key Considerations: If the user asks for a feature that is not in the Available Blocks or Integrations list, strictly return status: "impossible" and explain why in the clarification_question field. Do not hallucinate capabilities. If user request is vague, provide a clear clarification question. Else, set status to success. 
Output Format (JSON Only):
{
  "requiredBlockTypes": ["list of block_ids"],
  "requiredIntegrations": ["list of integration id required"],
  "requiredConfigs": ["list of app configs required"],
  "clarificationQuestion": null // Or a string if user's request is impossible or vague
  "status": "impossible | vague | success"
}`;
}
