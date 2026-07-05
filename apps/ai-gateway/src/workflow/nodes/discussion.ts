import { BaseNode } from "../../ai";
import type {
	NodeResult,
	ModelFactory,
	WorkflowMetadata,
	WorkflowContext,
} from "../../ai";
import { type ModelMessage, type LanguageModel, isStepCount } from "ai";
import { logger } from "@fluxify/common";

import { WorkflowToolName } from "../tools";

export interface DiscussionParams {
	query: string;
	messageHistory?: ModelMessage[];
	metadata: WorkflowMetadata; // To access routeId, projectId, location
	model: LanguageModel;
}

export interface DiscussionResult extends NodeResult {
	response?: string;
}

export class DiscussionNode extends BaseNode<
	DiscussionParams,
	DiscussionResult
> {
	constructor(modelFactory: ModelFactory) {
		super("discussion", modelFactory);
	}

	async execute(
		params: DiscussionParams,
		context: WorkflowContext,
	): Promise<DiscussionResult> {
		const { query, messageHistory = [], metadata, model } = params;

		try {
			const response = await this.callModel(
				{
					model,
					messages: [...messageHistory, { role: "user", content: query }],
					system: `You are the primary Discussion Agent for Fluxify - The Low-Code REST API builder platform.
Your core responsibility is to assist the user by having a meaningful, accurate, and concise discussion about the platform, their current workspace, and the available nodes/blocks.

Capabilities & Tools:
1. "search_docs": Use this tool whenever the user asks about platform features, how a specific block works, or best practices. Pass a highly relevant keyword search query to retrieve documentation chunks.
2. "get_route_details": Use this tool *only when necessary* if the user asks about the current route (the graph in canvas) they are viewing or working on. 

CRITICAL INSTRUCTIONS:
- If the user's query requires knowledge you don't possess, you MUST use the \`search_docs\` tool. Do not hallucinate answers.
- If the user's query lacks necessary context or details to provide a meaningful answer, fail early by explicitly asking the user to provide the missing information.
- If the user asks for actions outside your capabilities (like actually building a route), politely inform them that you are the discussion agent and they should ask to build a route directly.
- Keep your answers highly relevant, strictly based on provided documentation, and concisely structured. Decline requests that are not related to discussing the Fluxify platform.
- If the question is irrelavent to the user query, decline it politely.`,
					tools: {
						[WorkflowToolName.SEARCH_DOCS]:
							context.tools[WorkflowToolName.SEARCH_DOCS],
						[WorkflowToolName.GET_ROUTE_DETAILS]:
							context.tools[WorkflowToolName.GET_ROUTE_DETAILS],
					},
					stopWhen: isStepCount(20),
					maxRetries: 3,
				},
				context,
			);
			return {
				status: "success",
				response: response.text,
			};
		} catch (error: any) {
			logger.error("[DiscussionNode] Error during execution", { error });

			// If max steps exceeded or other error
			return {
				status: "failure",
				nextNodeId: undefined,
			};
		}
	}
}
