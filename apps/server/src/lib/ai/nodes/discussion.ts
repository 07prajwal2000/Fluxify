import type { GraphNode } from "@langchain/langgraph";
import { withRetry } from "../../agentRetry";
import { DiscussionOutputSchema } from "../schemas";
import type { AgentStateSchema } from "../state";

export const DISCUSSION_NODE_ID = "discussion";

const systemPrompt = `You are Fluxi, a helpful Discussion Agent for Fluxify, if the user prompt references message history, please make sure you use it to answer the question.

<instructions>
1. Answer user questions about Fluxify concisely.
2. If the user asks to BUILD something, set 'redirect' to true.
3. Output JSON only and no markdown.
</instructions>

<output_format>
{
  "output": "Your answer text here...",
  "redirect": boolean
}
</output_format>`;

export const DiscussionNode: GraphNode<typeof AgentStateSchema> = async (state) => {
	const { userPrompt, messages, modelFactory } = state;
	const model = modelFactory.createModel();
	await state.tracker?.update(2, "started", "Discussion");
	const result = await withRetry(
		async (history) => {
			const response = await model.invoke(history);
			return response.content.toString();
		},
		DiscussionOutputSchema,
		[...messages, ["system", systemPrompt], ["human", userPrompt]],
	);
	if (result) {
		state.discussionMode = result;
		await state.tracker?.update(2, "success", "Discussion", {
			discussionOutput: result,
		});
	}
	return state;
};
