import { BaseNode } from "../../../ai";
import type {
	NodeResult,
	ModelFactory,
	WorkflowMetadata,
	WorkflowContext,
} from "../../../ai/types";
import { type ModelMessage, type LanguageModel, Output } from "ai";
import { blockAiDescriptions } from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import z from "zod";
import type { BuilderState } from "./types";

// ── Structured output schema ──────────────────────────────────────────
const verifySchema = z.object({
	success: z
		.boolean()
		.describe("Whether the user's request can be fulfilled by the platform"),
	rejectReason: z
		.string()
		.optional()
		.describe("Human-readable reason if rejected"),
	reasoning: z.string().describe("Internal reasoning for the decision"),
	warnings: z
		.array(z.string())
		.optional()
		.describe("Non-blocking warnings, e.g. missing integrations"),
});

// ── Params / Result types ─────────────────────────────────────────────
export interface VerifyUserQueryParams {
	query: string;
	messageHistory?: ModelMessage[];
	metadata: WorkflowMetadata;
	model: LanguageModel;
	builderState: BuilderState;
}

export interface VerifyUserQueryResult extends NodeResult {
	success: boolean;
	rejectReason?: string;
	reasoning?: string;
	warnings?: string[];
	// forwarded to planner
	query?: string;
	messageHistory?: ModelMessage[];
	metadata?: WorkflowMetadata;
	model?: LanguageModel;
	builderState?: BuilderState;
	tokenUsage: { input: number; output: number };
}

// ── Block catalog (built once) ────────────────────────────────────────
function buildBlockCatalogTable(): string {
	const header = "| Block Name | Description |\n| --- | --- |";
	const rows = blockAiDescriptions.map(
		(b) => `| ${b.name} | ${b.description} |`,
	);
	return [header, ...rows].join("\n");
}

const BLOCK_CATALOG_TABLE = buildBlockCatalogTable();

// ── System prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the Verify User Query Agent for Fluxify — The Low-Code REST API builder platform.

## Your Responsibility
Analyze the user's request and determine if it can be satisfied by the platform's capabilities and available blocks. You are a strict gatekeeper — approve only requests that are genuinely achievable.

## Platform Capabilities
The platform can:
1. **Create & edit API routes** — REST API routes with configurable HTTP method, path, query params, and JSON body input schemas.
2. **Build route logic** — A directed acyclic graph (DAG) of blocks connected by edges. Each block performs a specific operation.
3. **Create custom blocks** — Reusable function-like logic composed of interconnected blocks.
4. **View integrations** — Connections to external services (databases, AI services, KV stores, observability). Each integration has an ID that certain blocks require to function.
5. **View app config** — Read-only access to environment variable names and descriptions (like a secrets vault).

## Platform Constraints (HARD LIMITS — always reject if violated)
- **REST only** — Pure request/response model. No file uploads, no form-data, no multipart, no SSE, no WebSockets, no streaming.
- **No server push** — Cannot maintain persistent connections or push data to clients.
- **Only the blocks listed below exist** — If the user's request requires functionality not covered by any block, reject it.
- **No direct code deployment** — The platform builds logic via blocks, not arbitrary code deployments (though a JS runner block exists for inline scripting).

## Available Blocks

${BLOCK_CATALOG_TABLE}

## Integration-Dependent Blocks
Some blocks (especially database blocks) require an \`integration ID\` — a pre-configured connection to an external service. If the user's request implies using such blocks but no specific integration is mentioned:
- Do NOT reject the request.
- Instead, mention in the reasoning that user will need to create the integration and link it to the relevant block.

## Decision Rules
1. If the request clearly maps to creating/editing routes using the available blocks → \`success: true\`
2. If the request clearly maps to creating a custom block using available blocks → \`success: true\`
3. If the request asks to view integrations or app config → \`success: true\`
4. If the request requires capabilities outside the platform (file uploads, WebSockets, SSE, form-data, features no block supports) → \`success: false\` with clear \`rejectReason\`
5. If the request is ambiguous but could plausibly be fulfilled → \`success: true\`
6. If the request is completely unrelated to API building → \`success: false\`

## Output
Return a JSON object with: success, rejectReason (if rejected), reasoning (your analysis).`;

// ── Node implementation ───────────────────────────────────────────────
export class VerifyUserQueryNode extends BaseNode<
	VerifyUserQueryParams,
	VerifyUserQueryResult
> {
	constructor(modelFactory: ModelFactory) {
		super("verifyUserQuery", modelFactory);
	}

	async execute(
		params: VerifyUserQueryParams,
		context: WorkflowContext,
	): Promise<VerifyUserQueryResult> {
		const { query, messageHistory = [], model, builderState } = params;

		try {
			const response = await this.callModel(
				{
					model,
					messages: [...messageHistory, { role: "user", content: query }],
					output: Output.object({ schema: verifySchema }),
					tools: {}, // no tools needed — pure reasoning
					instructions: SYSTEM_PROMPT,
				},
				context,
			);

			const { success, rejectReason, reasoning, warnings } = response.output;

			if (warnings && warnings.length > 0 && builderState) {
				builderState.scratchPad.push(...warnings);
			}

			if (!success) {
				logger.warn("[VerifyUserQueryNode] Request rejected", {
					rejectReason,
					reasoning,
				});
				return {
					status: "failure",
					success: false,
					rejectReason,
					reasoning,
					warnings,
					builderState,
					tokenUsage: {
						input: response.usage.inputTokens || 0,
						output: response.usage.outputTokens || 0,
					},
				};
			}

			return {
				status: "success",
				success: true,
				nextNodeId: "planner", // TODO: implement planner node
				reasoning,
				warnings,
				// forward data to planner
				query,
				messageHistory,
				metadata: context.metadata,
				model,
				builderState,
				tokenUsage: {
					input: response.usage.inputTokens || 0,
					output: response.usage.outputTokens || 0,
				},
			};
		} catch (error) {
			logger.error("[VerifyUserQueryNode] Error during execution", { error });
			return {
				status: "failure",
				success: false,
				rejectReason: "Internal error during query verification",
				tokenUsage: { input: 0, output: 0 },
			};
		}
	}
}
