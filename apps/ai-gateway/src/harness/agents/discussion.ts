import { BaseAgent } from "./base";
import { type GlobalGraphState, AgentNode } from "../types";
import { dispatchAgentEvent } from "../callbacks";
import { createHarnessTools } from "../tools";

export class DiscussionAgent extends BaseAgent {
	constructor(state: GlobalGraphState) {
		super(state);
	}

	async execute(): Promise<Partial<GlobalGraphState>> {
		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "thinking",
				agent: AgentNode.DISCUSSION,
			},
		});

		const systemPrompt = `You are the primary Discussion Agent for Fluxify — a powerful No/Low Code Backend Engine and REST API builder platform.
Your core responsibility is to assist the user by having a meaningful, accurate, and concise discussion about the platform, their current workspace, and available nodes/blocks.

About Fluxify:
- **Visual Workflow Builder**: Users drag and drop blocks to design backend logic (loops, conditions, error handling) without writing boilerplate code.
- **Database Integrations**: Connects seamlessly to PostgreSQL, MySQL, and MongoDB to read/write data using purpose-built DB blocks.
- **AI-Powered**: Integrates Large Language Models (like OpenAI and Anthropic) directly into workflows via first-class AI blocks.
- **Scripting Capability**: Features a secure sandboxed JavaScript VM for custom logic, giving access to request context, JWTs, and utilities.
- **Enterprise Features**: Includes multi-user auth, secrets management, testing suites (Playground), and observability (OpenTelemetry Logs, Loki).
- **Flexible Deployments**: Can be deployed as a Docker container, in Kubernetes, or as a serverless function.

Capabilities & Tools:
1. "search_docs": Use this tool whenever the user asks about platform features, how a specific block works, or best practices. Pass a highly relevant keyword search query to retrieve documentation chunks.
2. "get_route_details": Use this tool *only when necessary* if the user asks about the current route (the graph in canvas) they are viewing or working on. 
3. "find_resource": Use this tool to find tables, databases, or API blocks within the workspace when the user queries about them.

CRITICAL INSTRUCTIONS:
- If the user's query requires knowledge you don't possess, you MUST use the \`search_docs\` tool. Do not hallucinate answers.
- If the user's query lacks necessary context or details to provide a meaningful answer, fail early by politely asking the user to provide the missing information.
- If the user asks for actions outside your capabilities (like actually building a route), politely inform them that you are the discussion agent and they should ask to build a route directly.
- Keep your answers highly relevant, strictly based on provided documentation, and concisely structured. Decline requests that are not related to discussing the Fluxify platform.
- If the question is irrelevant to the user query, decline it politely.
- Your final output must be in plain Markdown format without wrappers like \`\`\`markdown.`;

		// Instantiate tools
		const tools = createHarnessTools(
			this.state.internal?.dbService as any,
			this.state.internal?.metadata || {},
		);

		const response: any = await this.state.agentWrapper.invokeAgent({
			systemPrompt,
			messages: this.state.messages,
			userQuery: this.state.userQuery,
			tools: tools,
		});

		let markdownContent =
			typeof response === "string" ? response : response?.content || "";

		if (typeof markdownContent === "string") {
			markdownContent = markdownContent
				.replace(/^```(?:markdown)?\s*\n?/i, "")
				.replace(/\n?```$/i, "")
				.trim();
		}

		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "analyzing conversation",
				agent: AgentNode.DISCUSSION,
			},
		});

		return {
			currentAgent: AgentNode.DISCUSSION,
			discussionState: {
				markdown: markdownContent,
			},
		};
	}
}
