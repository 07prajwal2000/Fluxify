import { BaseNode } from "../../ai";
import type { NodeResult, ModelFactory, WorkflowContext } from "../../ai/types";
import type { ModelMessage, LanguageModel } from "ai";
import { logger } from "@fluxify/common";

export interface ClassifierParams {
	query: string;
	messageHistory?: ModelMessage[];
	model: LanguageModel; // Required to execute the underlying model
}

export interface ClassifierResult extends NodeResult {
	nextNodeId?: "discussion" | "builder";
	reasoning?: string;
	route?: "discussion" | "builder" | "reject";
}

export class ClassifierNode extends BaseNode<
	ClassifierParams,
	ClassifierResult
> {
	constructor(modelFactory: ModelFactory) {
		super("classifier", modelFactory);
	}

	async execute(
		params: ClassifierParams,
		context: WorkflowContext,
	): Promise<ClassifierResult> {
		const { query, messageHistory = [], model } = params;

		logger.info("[ClassifierNode] Executing classifier", { query });

		try {
			// We use callModel which invokes the modelFactory's generateText under the hood.
			// We instruct the model to respond only with the desired route string.
			const response = await this.callModel(
				{
					model,
					messages: [...messageHistory, { role: "user", content: query }],
					system: `You are the primary Router and Classifier Agent for Fluxify - The Low-Code REST API builder platform.
Your critical responsibility is to analyze the user's incoming query and decide the absolute best agent to handle the request.

Available routes:
1. "discussion": Select this route IF AND ONLY IF the user is asking general questions about the application, documentation, available blocks, requesting an explanation of their current route, or just saying a general greeting.
2. "builder": Select this route IF AND ONLY IF the user explicitly wants to build a new API route from the ground up, or modify an existing graph.
3. "reject": Select this route IF the user query is completely unrelated to the platform, contains inappropriate content, OR if the query is too ambiguous or empty to classify.

CRITICAL INSTRUCTIONS:
- You must carefully analyze the query semantics.
- If the query lacks sufficient detail to determine a route, you MUST choose "reject". Fail early rather than guessing.
- You MUST respond with exactly ONE word from the available routes: "discussion", "builder", or "reject". 
- Do not include any other text, markdown formatting, punctuation, or reasoning in your response.`,
				},
				context,
			);

			const responseText = response.text.trim().toLowerCase();
			const isValidRoute = ["discussion", "builder", "reject"].includes(
				responseText,
			);
			const route = isValidRoute
				? (responseText as "discussion" | "builder" | "reject")
				: "reject";
			const reasoning = isValidRoute
				? "Model classified the route."
				: `Fallback reject. Model responded with: ${response.text}`;

			logger.info(`[ClassifierNode] Classified route: ${route}`, { reasoning });

			if (route === "reject") {
				logger.warn("[ClassifierNode] Query rejected by classifier", {
					reasoning,
				});
				return {
					status: "failure", // Stops the workflow
					route,
					reasoning,
				};
			}

			return {
				status: "success",
				nextNodeId: route, // "discussion" or "builder"
				route,
				reasoning,
			};
		} catch (error) {
			logger.error("[ClassifierNode] Error during execution", { error });
			return { status: "failure" };
		}
	}
}
