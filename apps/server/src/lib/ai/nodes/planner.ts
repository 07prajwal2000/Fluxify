import { blockAiDescriptions } from "@fluxify/blocks";
import { type ConditionalEdgeRouter, END, type GraphNode } from "@langchain/langgraph";
import { withRetry } from "../../agentRetry";
import { PlannerOutputSchema } from "../schemas";
import type { AgentStateSchema } from "../state";
import { BUILDER_NODE_ID } from "./builder";

export const PLANNER_NODE_ID = "planner";

const blockListStr = blockAiDescriptions.map((b) => `- ${b.name}: ${b.description}`).join("\n");

export const PlannerNode: GraphNode<typeof AgentStateSchema> = async (state) => {
	const { userPrompt, messages, modelFactory, metadata } = state;
	const emptyIntegrationListStr = "No integrations available.";
	const integrationListStr = metadata.integrationsList
		.map((i) => `- ${i.id} | ${i.name} | ${i.group} | ${i.variant}`)
		.join("\n");
	const existingBlockDetailsStr = state.metadata.route.canvasItems
		.map((b) => `- ${b.id} | ${b.blockType} | ${b.blockName}`)
		.join("\n");
	const emptyConfigListStr = "No configs available.";
	const appConfigListStr = metadata.configsList
		.map((c) => `- ${c.name} | ${c.description}`)
		.join("\n");
	const model = modelFactory.createModel();
	await state.tracker?.update(2, "started", "Planner");
	const result = await withRetry(
		async (history) => {
			const response = await model.invoke(history);
			return response.content.toString();
		},
		PlannerOutputSchema,
		[
			...messages,
			[
				"system",
				`You are Fluxi, an expert API Architect and Planner for a Low-Code API builder.

<objective>
Analyze the user's request to design a feasible node-based flow. You must select the necessary blocks and verify that the required external resources (Integrations/Configs) exist.
</objective>

<step_by_step_reasoning>
1. **Interpret Intent**: Understand the user's goal from their message. Use the available context — route metadata, existing blocks, integrations, and configs — to fill in gaps yourself. Do NOT ask the user for details you can reasonably infer or that the Builder Agent can resolve later (e.g., exact field names, response shapes, specific status codes, variable naming).

2. **Identify Blocks**: Determine which blocks from <available_resources.blocks> are needed to fulfill the request. If <available_resources.existing_blocks> is non-empty, the user may be requesting modifications to an existing flow — reuse existing blocks where appropriate.

3. **Check Resources**:
   - Does the request require external APIs (e.g., Postgres, OpenAI)? Check <available_resources.integrations>.
   - Does the request require secrets/env vars? Check <available_resources.configs>.

4. **Verify Feasibility**:
   - If specific required Integrations or Configs are missing -> status='impossible'.
   - If the request is genuinely ambiguous and you cannot determine the user's core intent even with available context -> status='vague'.
   - If all necessary resources exist -> status='success'.

</step_by_step_reasoning>

<available_resources>
<route_metadata>
- Name: ${state.metadata.route.name}
- Method: ${state.metadata.route.method}
- Path: ${state.metadata.route.path}
</route_metadata>

<existing_blocks>
ID | Type | Name (if exists)
 ${existingBlockDetailsStr}
</existing_blocks>

<blocks>
Name | Description
 ${blockListStr}
</blocks>

<integrations>
ID | Name | Group | Variant
 ${integrationListStr || emptyIntegrationListStr}
</integrations>

<configs>
Name | Description
 ${appConfigListStr || emptyConfigListStr}
</configs>
</available_resources>

<clarification_policy>
- **Prefer action over questions.** If you have enough context to determine a reasonable flow, output status='success' and let the Builder Agent handle the specifics.
- **Only ask when truly blocked.** Set status='vague' only when the user's core intent is unclear — not when minor implementation details are missing.
- **Never ask about things you can infer.** Route metadata, existing blocks, available integrations, and configs give you significant context. Use them.
- **Examples of things NOT to ask about:**
  - Exact field names or response body structure (Builder Agent decides based on block schemas).
  - Which status codes to return (sensible defaults exist).
  - Whether to add error handling (always good practice — include it).
  - Which integration to use when only one matching integration exists.
- **Examples of things worth asking about:**
  - The user says 'connect to the database' but multiple database integrations exist and the choice matters.
  - The user's request is contradictory or could mean two fundamentally different flows.
  - The user references a service/tool with no matching integration or config available.
</clarification_policy>

<constraints>
1. Output valid JSON ONLY. No markdown fences.
2. Use Block **Names** in the output.
3. Do not invent resources. If a required resource is missing, set status to 'impossible'.
4. If status is 'vague' or 'impossible', you MUST provide a helpful clarificationQuestion.
5. When status is 'success', clarificationQuestion MUST be null.
6. Err on the side of proceeding. A good-enough plan that the Builder Agent can refine is better than blocking the user with questions.
</constraints>

<output_format>
{
  "status": "success | vague | impossible",
  "reasoning": "string (Explain why the flow is possible or what is missing. This will be used as message history in future, so make it concise and clear.)",
  "clarificationQuestion": "string | null",
  "plannedBlockNames": ["string"]
}
</output_format>
`,
			],
			["human", userPrompt],
		],
	);
	if (result) {
		state.buildMode = { plannerOutput: result };
		await state.tracker?.update(2, "success", "Planner", {
			plannerOutput: result,
		});
	}
	return state;
};

export const PlannerConditionalNodeRouter: ConditionalEdgeRouter<typeof AgentStateSchema> = (
	state,
) => {
	return state.buildMode?.plannerOutput?.status === "success" ? BUILDER_NODE_ID : END;
};
