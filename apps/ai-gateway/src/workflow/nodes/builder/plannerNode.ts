import { BaseNode } from "../../../ai";
import type {
	NodeResult,
	ModelFactory,
	WorkflowMetadata,
	WorkflowContext,
} from "../../../ai/types";
import { type ModelMessage, type LanguageModel, Output, isStepCount } from "ai";
import { blockAiDescriptions } from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import z from "zod";
import type { BuilderState, PlannerOutput } from "./types";
import { WorkflowToolName } from "../../tools";

// ── Structured output schema ──────────────────────────────────────────
const plannerOutputSchema = z.object({
	markdownPlan: z
		.string()
		.describe(
			"A detailed, human-readable markdown plan with numbered task bullets.",
		),
	success: z
		.boolean()
		.describe("Whether a feasible plan could be constructed."),
	rejectReason: z
		.string()
		.optional()
		.describe("If success is false, the reason why the flow is impossible."),
	thinkingProcess: z
		.string()
		.describe(
			"Internal reasoning, resources discovered, and warnings for missing configs/integrations.",
		),
	scratchPad: z
		.array(z.string())
		.describe(
			"Array of contextual notes, resource IDs, or warnings to pass to downstream sub-agents.",
		),
});

// ── Params / Result types ─────────────────────────────────────────────
export interface PlannerParams {
	query: string;
	messageHistory?: ModelMessage[];
	metadata: WorkflowMetadata;
	model: LanguageModel;
	builderState: BuilderState;
}

export interface PlannerResult extends NodeResult {
	plannerOutput?: PlannerOutput;
	builderState: BuilderState;
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
const SYSTEM_PROMPT = `You are Fluxi, an expert API Architect and Planner for Fluxify — a Low-Code REST API builder platform.

## Your Responsibility
Your task is to analyze the user's request and create a detailed, human-readable markdown plan. The user will review this plan. If approved, orchestrator and sub-agents will execute it.

## Platform Capabilities & Constraints
- **REST only**: Pure request/response model. No file uploads, WebSockets, or streaming.
- **Block-based logic**: API routes and custom blocks are built using a directed acyclic graph of blocks.
- **No arbitrary code**: You must use the available blocks. (The JS Runner block can be used for inline logic).

## Available Blocks
${BLOCK_CATALOG_TABLE}

## External Dependencies
Some blocks (like DB or AI blocks) require an **integration ID**.
Other blocks may require secrets from **app configs**.
**WARNING**: You MUST use the \`find_resource\` tool to check if the required integrations or configs exist in the user's project BEFORE finalizing the plan. 
- If an integration/config is missing, DO NOT reject the request. Instead, add a prominent warning in your \`markdownPlan\` stating that the user must create it.
- Also use \`find_resource\` to discover existing routes or custom blocks if the user is asking to modify them.
- If you are unsure how a block works, use \`search_docs\` to look up its capabilities and platform info.

## Output Instructions
1. **Markdown Plan**: Create a clear, numbered list of tasks.
   - For each task, specify: Resource Action (Create/Edit), Target (Route/Custom Block), Blocks Needed, Integration Dependencies, and Expected I/O shapes.
   - Group tasks logically under section headers.
   - Flag any missing dependencies clearly as warnings.
2. **Scratch Pad**: Accumulate all resource lookup results (IDs, names), reasoning, and warnings into the \`scratchPad\` array. This is passed to downstream agents so they don't have to re-search.
3. **Clarification**: Prefer action over questions. Only set \`success: false\` if the request is fundamentally impossible given platform constraints.

Plan carefully and thoroughly.`;

// ── Node implementation ───────────────────────────────────────────────
export class PlannerNode extends BaseNode<PlannerParams, PlannerResult> {
	constructor(modelFactory: ModelFactory) {
		super("planner", modelFactory);
	}

	async execute(
		params: PlannerParams,
		context: WorkflowContext,
	): Promise<PlannerResult> {
		const { query, messageHistory = [], model, builderState } = params;

		try {
			// Explicitly inject only the tools we want the planner to use
			const allowedTools = {
				[WorkflowToolName.FIND_RESOURCE]:
					context.tools[WorkflowToolName.FIND_RESOURCE],
				[WorkflowToolName.SEARCH_DOCS]:
					context.tools[WorkflowToolName.SEARCH_DOCS],
			};

			const scratchPadText = builderState.scratchPad?.length
				? `\n\n## Context / Scratch Pad\nHere is information gathered from previous steps:\n${builderState.scratchPad.map((s) => `- ${s}`).join("\n")}`
				: "";
			logger.info("Planner query tools", "plannerNode", { query });

			const response = await this.callModel(
				{
					model,
					messages: [...messageHistory, { role: "user", content: query }],
					output: Output.object({ schema: plannerOutputSchema }),
					tools: allowedTools as any,
					instructions: SYSTEM_PROMPT + scratchPadText,
					maxSteps: 5,
				},
				context,
			);

			const {
				markdownPlan,
				success,
				rejectReason,
				thinkingProcess,
				scratchPad,
			} = response.output;

			// Append new context to existing scratchpad
			builderState.scratchPad.push(...scratchPad, thinkingProcess);

			// Halting the workflow loop to wait for user review
			builderState.workflowStatus = "under_plan_review";
			builderState.plannerOutput = {
				markdownPlan,
				success,
				rejectReason,
				thinkingProcess,
				scratchPad,
			};

			return {
				status: "success",
				// No nextNodeId -> Halts execution
				plannerOutput: builderState.plannerOutput,
				builderState,
				tokenUsage: {
					input: response.usage.inputTokens || 0,
					output: response.usage.outputTokens || 0,
				},
			};
		} catch (error) {
			logger.error("[PlannerNode] Error during execution", { error });
			return {
				status: "failure",
				builderState,
				tokenUsage: { input: 0, output: 0 },
			};
		}
	}
}
