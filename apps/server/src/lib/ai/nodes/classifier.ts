import { ConditionalEdgeRouter, GraphNode } from "@langchain/langgraph";
import { AgentStateSchema } from "../state";
import { ClassifierOutputSchema } from "../schemas";
import { withRetry } from "../../agentRetry";
import { PLANNER_NODE_ID } from "./planner";
import { DISCUSSION_NODE_ID } from "./discussion";

export const CLASSIFIER_NODE_ID = "classifier";

export const ClassifierNode: GraphNode<typeof AgentStateSchema> = async (
  state,
) => {
  const { userPrompt, messages, modelFactory } = state;
  const model = modelFactory.createModel();
  const result = await withRetry(
    async (history) => {
      const response = await model.invoke(history);
      return response.content.toString();
    },
    ClassifierOutputSchema,
    [
      ...messages,
      [
        "system",
        `You are a router. Classify the user's intent.
<intent_definitions>
- DISCUSSION: Questions about how things work, documentation, greetings, or theoretical help.
- BUILD: Requests to generate code, create endpoints, add nodes, or modify the application logic.
</intent_definitions>

<output_rules>
- Output JSON ONLY.
- No Markdown.
- Keep reasoning under 10 words.
</output_rules>

<output_structure>
{
  "intent": "string",
  "reasoning": "string" // your reasoning will be used as messages history in future. so make it concise and clear.
}
</output_structure>`,
      ],
      ["human", userPrompt],
    ],
  );
  if (result) {
    state.classifierOutput = result;
  }
  return state;
};

export const ClassifierConditionalNodeRouter: ConditionalEdgeRouter<
  typeof AgentStateSchema
> = (state) => {
  return state.classifierOutput.intent === "BUILD"
    ? PLANNER_NODE_ID
    : DISCUSSION_NODE_ID;
};
