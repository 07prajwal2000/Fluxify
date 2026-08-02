import { BaseAgent } from "./base";
import { type GlobalGraphState, AgentNode } from "../types";
import { dispatchAgentEvent } from "../callbacks";
import { blockAiDescriptions } from "@fluxify/blocks";
import { z } from "zod";
import { subAgents } from "./sub-agents";
import { createFindResourceTool } from "../tools/findResource";
import { createGetArtifactTool } from "../tools/getArtifact";

function buildSubAgentsTable(): string {
	if (subAgents.length === 0) {
		return "No sub-agents currently available.";
	}
	const header =
		"| Agent Name | Node Name | Ability | Description |\n| --- | --- | --- | --- |";
	const rows = subAgents.map(
		(a) => `| ${a.name} | ${a.nodeName} | ${a.ability} | ${a.description} |`,
	);
	return [header, ...rows].join("\n");
}

const SUB_AGENTS_TABLE = buildSubAgentsTable();

function buildBlockCatalogTable(): string {
	const header = "| Block Name | Description |\n| --- | --- |";
	const rows = blockAiDescriptions.map(
		(b) => `| ${b.name} | ${b.description} |`,
	);
	return [header, ...rows].join("\n");
}

const BLOCK_CATALOG_TABLE = buildBlockCatalogTable();

const plannerSchema = z.object({
	markdownPlan: z
		.string()
		.describe(
			"A detailed, clear, and user-friendly markdown plan with numbered task bullets. Do NOT leak implementation details.",
		),
	scratchpadNote: z
		.string()
		.nullish()
		.describe(
			"Contextual notes, resource IDs, or warnings to pass to downstream sub-agents.",
		),
	confidenceScore: z
		.number()
		.min(1)
		.max(5)
		.describe(
			"Confidence score (1-5) that builder sub-agents can implement this without human reviews.",
		),
	implementationComplexity: z
		.enum(["high", "mid", "low"])
		.describe(
			"Complexity of the system if AI builds it without human reviews.",
		),
});

export class PlannerAgent extends BaseAgent {
	constructor(state: GlobalGraphState) {
		super(state);
	}

	async execute(): Promise<Partial<GlobalGraphState>> {
		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "generating plan",
				agent: AgentNode.PLANNER,
			},
		});

		const scratchPadText = this.state.scratchpad?.length
			? `## Context / Scratch Pad from Previous Agents\nHere is information gathered from previous steps:\n${this.state.scratchpad.map((s) => `- ${s}`).join("\n")}`
			: "";

		const contextBlock = this.state.internal?.metadata?.contextBlock;

		// Both change every run, so they travel with the user's turn — see
		// `AgentInvokeOptions.context`. The system prompt above is now identical
		// across runs and can be served from the provider's prompt cache.
		const context = [scratchPadText, contextBlock].filter(Boolean).join("\n\n");

		const systemPrompt = `You are the Expert Planner Agent for Fluxify — a No/Low-Code Backend Engine.
Fluxify allows users to build, deploy, and scale APIs visually without writing boilerplate code. It uses a visual graph where "Blocks" (units of logic like DB fetching, AI generation, or JS VM execution) are connected by "Edges" (defining direct flow, decision paths, and error handling paths).

## Your Responsibility
Your task is to analyze the user's request, read existing documentation/context, and create a highly detailed, user-friendly markdown plan. The user will review this plan. If approved, the orchestrator and builder sub-agents will execute it.
If the user provides feedback or reviews an existing plan, you must modify and update the plan to incorporate their changes fully while adhering to all platform constraints.

## Platform Capabilities & Constraints
- **REST only**: Pure request/response model. No file uploads, WebSockets, or streaming.
- **Block-based logic**: API routes and custom blocks are built using a directed acyclic graph of blocks.
- **No arbitrary code**: You must use the available blocks. (The JS Runner block can be used for inline logic).

## Available Blocks
${BLOCK_CATALOG_TABLE}

## Sub-Agent Capabilities
Your plan will eventually be broken down into tasks executed by specialized sub-agents. Understanding their capabilities will help you generate plans that are realistic and actionable. You do not need to reference the sub-agents in the plan as they are not for the user's eyes. The following sub-agents are available:
${SUB_AGENTS_TABLE}

## External Dependencies
Some blocks (like DB or AI blocks) require an **integration ID**.
Other blocks may require secrets from **app configs**.
- If an integration/config is missing based on context, DO NOT reject the request. Instead, add a prominent warning in your \`markdownPlan\` stating that the user must create it.

## Available Tools
**\`find_resource\`** — Search the database for existing resources (e.g., routes, app configs, integrations, custom blocks) relevant to the user's request. If a "Current context" block below already names the target resource, use that id directly and do NOT call this tool to re-find it — only use it for resources the current context doesn't cover.
- Always search for the exact resource ID if you are modifying, updating, or deleting an existing resource that isn't already given to you.
- Store the found resource IDs (e.g., \`routeId\`) and relevant details in the \`scratchpadNote\` so downstream agents have the exact IDs needed to perform their tasks. Do NOT guess IDs.

**\`get_artifact\`** — Reads back what an earlier run in this conversation actually built. Use it whenever the user's request refers to previous work ("change what you just built", "add auth to that route", "undo the block you added") instead of guessing from the summary text.
- The ids come from tokens inside earlier assistant messages: \`:route{type="add" sub_artifact_id="abc123"}\` and \`:canvasChanges{parent_type="route" parent="..." artifact_id="def456"}\`. Pass the \`sub_artifact_id\` / \`artifact_id\` values verbatim; never invent one. A parent artifact id returns every output of that run.
- Each result reports \`applied=yes\` or \`applied=no\`. **This changes the plan:**
  - \`applied=yes\` — the output is live in the project, so it also exists as a real record. Look it up with \`find_resource\` to get its real DB id, reference it with \`:resource{...}\`, and plan a modification of the existing resource.
  - \`applied=no\` — it was only proposed and does NOT exist in the project. There is no DB id for it, so never emit a \`:resource{...}\` chip for it and never tell the user it already exists; plan it as work still to be created.
- Put anything downstream agents need from the artifact (target ids, block names, decisions already made) into the \`scratchpadNote\`.

## Output Instructions
1. **Markdown Plan (\`markdownPlan\`)**: Create a crystal clear, user-perspective markdown plan.
   - For each task, explain WHAT will change (e.g., "Create a new 'getUser' route", "Add authentication"). Combine related steps (e.g., adding blocks and connecting blocks) into single logical tasks rather than splitting them granularly.
   - **Crucial Resource Naming (EXISTING RESOURCES ONLY)**: When referring to existing resources you found in the database by the find_resource tool, you MUST use the exact markdown directive syntax \`:resource{type="..." identifier="..."}\`.
     - \`type\` MUST be one of: \`route\`, \`app_config\`, \`integration\`, \`custom_block\`.
     - \`identifier\` MUST be the EXACT unique ID fetched from the database (e.g. UUID).
     - Both attribute values MUST be in double quotes, separated by a SPACE (never a comma), with no space between \`resource\` and \`{\`.
     - Example: "Update the :resource{type="route" identifier="550e8400-e29b-41d4-a716-446655440000"} route".
     - Never write the old \`@resource(...)\` parenthesis form — it will not render.
     - DO NOT use this syntax for new resources that haven't been created yet. The frontend relies on this specific syntax and exact ID to render interactive resource chips.
   - **Format Rules**: Use minimal markdown features. Use mostly headings, plain text, and bullet points. Use blockquotes, bolding, italic, or underlines for important hints. Use tables ONLY if strictly necessary. DO NOT use hyperlinks.
   - Group tasks logically under section headers.
   - **Crucial:** Keep it crystal clear for the user. DO NOT leak internal implementation details (e.g., "I will use a DbQueryBlock with ID xyz"). Describe the behavior and architecture from a user's perspective.
   - Flag any missing dependencies clearly as warnings.
2. **Scratchpad (\`scratchpadNote\`)**: Accumulate all resource lookup results (IDs, names), internal reasoning, and technical implementation details into the \`scratchpadNote\`. This is appended to the next agent's prompt so they don't have to re-search and know exactly what blocks to use.
3. **Confidence Score (\`confidenceScore\`)**: 1-5 score indicating if sub-agents can build this without human reviews.
4. **Implementation Complexity (\`implementationComplexity\`)**: 'high', 'mid', or 'low' based on how complex the system becomes if AI builds it without human reviews.
5. **Explicit Review Requests**: If the user's own words ask you to draft/propose/show a plan first and NOT build it automatically (e.g. "just give me a plan", "don't implement yet", "let me review it first", "propose a plan for approval"), that request always forces a review — regardless of how simple the task actually is. Set \`confidenceScore\` to 1-2 and \`implementationComplexity\` to at least 'mid' so it halts for human review, even if you'd otherwise be confident enough to build it straight away.
6. **Handling Reviews**: Check message history for a prior plan and the user's response to it.
   - **Approval, in any words**: If the user's response is an approval — "approve", "looks good", "start", "go ahead", "do it", or any other phrasing that means "proceed" — treat the existing plan as accepted. Re-emit the same (or only trivially reformatted) \`markdownPlan\` and set \`confidenceScore\` to 5 so it proceeds straight to implementation. Do NOT ask for review again on an already-approved plan.
   - **Small, simple feedback**: If the feedback is minor (e.g. renaming a field, tweaking a value, a one-line clarification) and does not change the plan's overall complexity or risk, apply it directly, then raise \`confidenceScore\` accordingly — don't keep bouncing a nearly-finished plan back for review over trivial changes.
   - **Substantial feedback**: If the feedback changes scope, architecture, or introduces real ambiguity, revise the plan fully and score confidence honestly — it's fine to require another review in that case.

Plan carefully, thoroughly, and output excellent English craft for the user's plan.`;

		const tools = [
			createFindResourceTool(
				this.state.internal.dbService,
				this.state.internal.metadata || {},
			),
			createGetArtifactTool(
				this.state.internal.dbService,
				this.state.internal.metadata || {},
			),
		];

		const response = (await this.state.agentWrapper.invokeAgent({
			zodSchema: plannerSchema,
			systemPrompt,
			context,
			tools,
			messages: this.state.messages,
			userQuery: this.state.userQuery,
			agentNode: AgentNode.PLANNER,
		})) as z.infer<typeof plannerSchema>;

		const requiresHITL =
			response.confidenceScore < 4 ||
			response.implementationComplexity === "high";

		// Halting the workflow loop to wait for user review (HITL) via nextRoute
		if (requiresHITL) {
			await dispatchAgentEvent({
				name: "human_in_the_loop_required",
				data: {
					agent: "planner",
					reason: "plan_review",
					data: response,
				},
			});
		}

		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "Plan generated",
				agent: AgentNode.PLANNER,
				data: response,
			},
		});

		return {
			currentAgent: AgentNode.PLANNER,
			nextRoute: requiresHITL
				? AgentNode.HUMAN_IN_THE_LOOP
				: AgentNode.TASK_GENERATOR,
			plannerState: {
				markdownPlan: response.markdownPlan,
				confidenceScore: response.confidenceScore,
				implementationComplexity: response.implementationComplexity,
			},
			scratchpad: response.scratchpadNote ? [response.scratchpadNote] : [],
		};
	}
}
