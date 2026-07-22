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

const verifySchema = z.object({
	capable: z
		.boolean()
		.describe(
			"Whether the user's request can be fulfilled by the platform capabilities and blocks.",
		),
	rejectReason: z
		.string()
		.optional()
		.describe(
			"Human-readable reason if rejected. Must be provided if capable is false.",
		),
	scratchpad: z
		.string()
		.optional()
		.describe(
			"A scratchpad note for descendant AI agents. Use this to pass important context, warnings, or missing integration info. Fill only if required.",
		),
});

export class VerifyUserQueryAgent extends BaseAgent {
	constructor(state: GlobalGraphState) {
		super(state);
	}

	async execute(): Promise<Partial<GlobalGraphState>> {
		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "verifying capabilities",
				agent: AgentNode.VERIFY_USER_QUERY,
			},
		});

		const systemPrompt = `You are the Verify User Query Agent for Fluxify — The Agentic Low-Code Backend Development Platform.

## Your Responsibility
Your absolute critical responsibility is to analyze the user's request and determine if it can be satisfied by Fluxify's capabilities and available blocks. You are a strict gatekeeper — approve only requests that are genuinely achievable.

## Platform Capabilities
Fluxify empowers users to build backends visually without boilerplate:
1. **Create & Edit API Routes**: REST API endpoints with configurable HTTP methods, paths, query params, and JSON body input schemas.
2. **Build Route Logic**: Construct a directed acyclic graph (DAG) of blocks connected by edges. Each block performs a specific operation.
3. **Execution Engine**: Runs workflows block by block, manages an Execution Context (vars, VM, DB, timeout), and enforces a 4-second timeout by default.
4. **Create Custom Blocks**: Reusable function-like logic composed of interconnected blocks.
5. **View Integrations**: Connect to external services (PostgreSQL, LLMs like OpenAI/Anthropic, KV stores, observability). Database blocks require an Integration ID.
6. **Scripting Capability**: "JS Runner" block allows running custom JavaScript in a secure VM with access to request context, JWT, and utility libraries.

## Platform Constraints (HARD LIMITS — always reject if violated)
- **REST Only**: Pure request/response model. NO file uploads, NO form-data, NO multipart, NO SSE, NO WebSockets, NO streaming.
- **No Server Push**: Cannot maintain persistent connections or push data to clients.
- **Only the blocks listed below exist**: If the user's request requires functionality not covered by any block, reject it.
- **No direct code deployment**: The platform builds logic via blocks, not arbitrary code deployments (though a JS runner block exists for inline scripting).
- **Execution Timeout**: Any workflow logic taking inherently more than 4 seconds (e.g., long background scraping without chunking) will fail. 

## Available Blocks

${BLOCK_CATALOG_TABLE}

## Integration-Dependent Blocks
Some blocks (especially Database blocks) require an \`integration ID\` (a connection to PostgreSQL, etc.). If the user's request implies using such blocks but no specific integration is mentioned:
- Do NOT reject the request.
- Instead, in your reasoning, note that the user will need to configure the required integration and link it to the relevant block.

## Decision Rules
1. **Approve (capable: true)** if the request clearly maps to creating/editing routes or custom blocks using the available blocks.
2. **Approve (capable: true)** if the request asks to view integrations or app configuration.
3. **Approve (capable: true)** if the request is ambiguous but plausibly fulfillable by Fluxify blocks.
4. **Reject (capable: false)** if the request requires capabilities outside the platform (file uploads, WebSockets, SSE, form-data, unsupported features).
5. **Reject (capable: false)** if the request is completely unrelated to API building or Fluxify.

## Output
Analyze the request internally. Instead of raw reasoning, provide a 'scratchpad' note for future AI agents if there are important context, warnings, or missing integration details. If rejecting, provide a clear 'rejectReason' for the user.`;

		const response = (await this.state.agentWrapper.invokeAgent({
			zodSchema: verifySchema,
			systemPrompt,
			messages: this.state.messages,
			userQuery: this.state.userQuery,
		})) as z.infer<typeof verifySchema>;

		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: response.capable
					? "Capability Verified"
					: "Capability Rejected",
				agent: AgentNode.VERIFY_USER_QUERY,
				data: response,
			},
		});

		return {
			currentAgent: AgentNode.VERIFY_USER_QUERY,
			nextRoute: response.capable ? AgentNode.PLANNER : undefined,
			verifyUserQueryState: {
				capable: response.capable,
				rejectReason: response.rejectReason,
			},
			scratchpad: response.scratchpad ? [response.scratchpad] : [],
		};
	}
}
