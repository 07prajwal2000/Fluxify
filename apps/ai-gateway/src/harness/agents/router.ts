import { BaseAgent } from "./base";
import { type GlobalGraphState, AgentNode } from "../types";
import { dispatchAgentEvent } from "../callbacks";
import { blockAiDescriptions } from "@fluxify/blocks";
import { z } from "zod";

function buildBlockCatalogTable(): string {
	const header = "| Block Name | Description |\n| --- | --- |";
	const rows = blockAiDescriptions.map(
		(b) => `| ${b.name} | ${b.description} |`,
	);
	return [header, ...rows].join("\n");
}

const BLOCK_CATALOG_TABLE = buildBlockCatalogTable();

const routerSchema = z.object({
	intent: z
		.enum(["discussion", "builder"])
		.describe(
			"The intended route based on the user's request. 'discussion' for general chats, greetings, or questions not related to building. 'builder' for requests to develop, build, edit, delete, or modify any stuff related to fluxify.",
		),
	reason: z.string().describe("A short brief reason for the classification."),
	capable: z
		.boolean()
		.default(true)
		.describe(
			"Only meaningful when intent is 'builder': whether the request can be fulfilled by the platform capabilities and available blocks. Always true for 'discussion'.",
		),
	rejectReason: z
		.string()
		.nullish()
		.describe(
			"Human-readable reason if the build request was rejected. Must be provided if capable is false.",
		),
	scratchpad: z
		.string()
		.nullish()
		.describe(
			"A scratchpad note for descendant AI agents. Use this to pass important context, warnings, or missing integration info. Fill only if required.",
		),
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

		const contextBlock = this.state.internal?.metadata?.contextBlock;

		const systemPrompt = `You are the primary Router and Gatekeeper Agent for Fluxify, an Agentic Low Code Backend Development Platform.
Your absolute critical responsibility is to analyze the user's incoming query and conversation history, then decide the correct routing mode — and, for build requests, whether the platform can actually deliver it.

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

## Capability Check (only when intent is "builder")
You are also the gatekeeper: a build request that the platform cannot deliver must be rejected here rather than half-built. Set \`capable: false\` with a clear \`rejectReason\`. For "discussion" always set \`capable: true\`.

### Platform Capabilities
1. **Create & Edit API Routes**: REST API endpoints with configurable HTTP methods, paths, query params, and JSON body input schemas.
2. **Build Route Logic**: Construct a directed acyclic graph (DAG) of blocks connected by edges. Each block performs a specific operation.
3. **Execution Engine**: Runs workflows block by block, manages an Execution Context (vars, VM, DB, timeout), and enforces a 4-second timeout by default.
4. **Create Custom Blocks**: Reusable function-like logic composed of interconnected blocks.
5. **View Integrations**: Connect to external services (PostgreSQL, LLMs like OpenAI/Anthropic, KV stores, observability). Database blocks require an Integration ID.
6. **Scripting Capability**: "JS Runner" block allows running custom JavaScript in a secure VM with access to request context, JWT, and utility libraries.

### Platform Constraints (HARD LIMITS — always reject if violated)
- **REST Only**: Pure request/response model. NO file uploads, NO form-data, NO multipart, NO SSE, NO WebSockets, NO streaming.
- **No Server Push**: Cannot maintain persistent connections or push data to clients.
- **Only the blocks listed below exist**: If the user's request requires functionality not covered by any block, reject it.
- **No direct code deployment**: The platform builds logic via blocks, not arbitrary code deployments (though a JS runner block exists for inline scripting).
- **Execution Timeout**: Any workflow logic taking inherently more than 4 seconds (e.g., long background scraping without chunking) will fail.

### Available Blocks

${BLOCK_CATALOG_TABLE}

### Integration-Dependent Blocks
Some blocks (especially Database blocks) require an \`integration ID\` (a connection to PostgreSQL, etc.). If the user's request implies using such blocks but no specific integration is mentioned:
- Do NOT reject the request.
- Instead, note in the 'scratchpad' that the user will need to configure the required integration and link it to the relevant block.

### Decision Rules
1. **capable: true** if the request clearly maps to creating/editing routes or custom blocks using the available blocks.
2. **capable: true** if the request asks to view integrations or app configuration.
3. **capable: true** if the request is ambiguous but plausibly fulfillable by Fluxify blocks.
4. **capable: false** if the request requires capabilities outside the platform (file uploads, WebSockets, SSE, form-data, unsupported features).
5. **capable: false** if the request is completely unrelated to API building or Fluxify. (Such requests are normally "discussion" — reject only when the user is asking to *build* something impossible.)

CRITICAL INSTRUCTIONS:
- You must carefully analyze the query semantics and history. Do not guess.
- Your output must rigidly conform to the provided schema.
- You MUST select exactly ONE 'intent': either "discussion" or "builder".
- Provide a concise but definitive reason for your classification in the 'reason' field.
- Instead of raw reasoning, provide a 'scratchpad' note for the downstream agents if there is important context, a warning, or a missing integration detail.`;

		const response = (await this.state.agentWrapper.invokeAgent({
			zodSchema: routerSchema,
			systemPrompt,
			context: contextBlock,
			messages: this.state.messages,
			userQuery: this.state.userQuery,
			agentNode: AgentNode.ROUTER,
		})) as z.infer<typeof routerSchema>;

		// A rejection only applies to build requests — the discussion agent answers
		// out-of-scope questions safely and needs no capability gate.
		const rejected = response.intent === "builder" && !response.capable;

		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: rejected
					? "Capability Rejected"
					: `Routed to ${response.intent}`,
				agent: AgentNode.ROUTER,
				data: { reason: response.reason },
			},
		});

		return {
			currentAgent: AgentNode.ROUTER,
			nextRoute: rejected
				? undefined
				: response.intent === "builder"
					? AgentNode.PLANNER
					: AgentNode.DISCUSSION,
			routerState: {
				intent: response.intent,
				reason: response.reason,
				capable: !rejected,
				rejectReason: rejected
					? (response.rejectReason ?? response.reason)
					: undefined,
			},
			scratchpad: response.scratchpad ? [response.scratchpad] : [],
		};
	}
}
