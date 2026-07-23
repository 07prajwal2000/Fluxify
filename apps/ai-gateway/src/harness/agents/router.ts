import { BaseAgent } from "./base";
import { type GlobalGraphState, AgentNode } from "../types";
import { dispatchAgentEvent } from "../callbacks";
import { z } from "zod";

const routerSchema = z.object({
	intent: z
		.enum(["discussion", "builder"])
		.describe(
			"The intended route based on the user's request. 'discussion' for general chats, greetings, or questions not related to building. 'builder' for requests to develop, build, edit, delete, or modify any stuff related to fluxify.",
		),
	reason: z.string().describe("A short brief reason for the classification."),
});

export class RouterAgent extends BaseAgent {
	constructor(state: GlobalGraphState) {
		super(state);
	}

	async execute(): Promise<Partial<GlobalGraphState>> {
		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "routing query",
				agent: AgentNode.ROUTER,
			},
		});

		const systemPrompt = `You are the primary Router and Classifier Agent for Fluxify, an Agentic Low Code Backend Development Platform.
Your absolute critical responsibility is to analyze the user's incoming query and conversation history, then decide the correct routing mode.

About Fluxify:
- Fluxify allows users to build backend logic without writing code via a visual workflow builder.
- Users drag and drop blocks (e.g., Entrypoints, HTTP Requests, Databases, LLMs) to design business logic.
- It connects to external databases, integrates AI models, and supports custom scripting.

Available Routes & Criteria:
1. "discussion" Mode: 
   - Choose this route IF the user asks general questions about the application, architecture, or documentation.
   - Choose this route IF the user is asking about available blocks, explaining existing routes, or requesting tutorials.
   - Choose this route for general greetings, conversational inputs, or ambiguous/incomplete prompts.
   - Choose this route IF the request is completely unrelated to Fluxify, as the discussion agent can handle out-of-bounds queries safely.
   
2. "builder" Mode:
   - Choose this route IF AND ONLY IF the user explicitly wants to develop, build, modify, or delete elements related to Fluxify workflows or API routes.
   - Choose this route when actionable development tasks (e.g., adding a database block, modifying a query, deleting an endpoint) are requested.

CRITICAL INSTRUCTIONS:
- You must carefully analyze the query semantics and history. Do not guess.
- Your output must rigidly conform to the provided schema. 
- You MUST select exactly ONE 'intent': either "discussion" or "builder".
- Provide a concise but definitive reason for your classification in the 'reason' field.`;

		const response = (await this.state.agentWrapper.invokeAgent({
			zodSchema: routerSchema,
			systemPrompt,
			messages: this.state.messages,
			userQuery: this.state.userQuery,
		})) as z.infer<typeof routerSchema>;

		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: `Routed to ${response.intent}`,
				agent: AgentNode.ROUTER,
				data: { reason: response.reason },
			},
		});

		return {
			currentAgent: AgentNode.ROUTER,
			nextRoute:
				response.intent === "builder"
					? AgentNode.VERIFY_USER_QUERY
					: AgentNode.DISCUSSION,
			routerState: {
				intent: response.intent,
				reason: response.reason,
			},
		};
	}
}
