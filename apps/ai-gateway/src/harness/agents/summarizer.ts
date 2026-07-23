import { BaseAgent } from "./base";
import { type GlobalGraphState, AgentNode } from "../types";
import { dispatchAgentEvent } from "../callbacks";

/** A single change the harness made, with its verbatim special-syntax token. */
interface ChangeRef {
	label: string;
	actionLabel: string;
	agentRole: string;
	/** Exact token the LLM must place verbatim at the end of its line. */
	token: string;
}

function isRouteConfigResult(r: any): boolean {
	return (
		r &&
		typeof r.action === "string" &&
		["create", "delete", "update-partial"].includes(r.action)
	);
}

function isBlockBuilderResult(r: any): boolean {
	return (
		r &&
		(Array.isArray(r.blocks) ||
			Array.isArray(r.canvasChanges) ||
			typeof r.status === "string")
	);
}

/**
 * Runs last, after all build agents. Deterministically persists each sub-agent
 * output as a sub-artifact under a parent artifact, then asks the LLM to write a
 * concise, human-readable summary of what the run changed — embedding the
 * special-syntax tokens (documented in harness/notes.md) so the frontend can
 * render interactive chips. The generated markdown is the run's final result.
 */
export class SummarizerAgent extends BaseAgent {
	constructor(state: GlobalGraphState) {
		super(state);
	}

	async execute(): Promise<Partial<GlobalGraphState>> {
		await dispatchAgentEvent({
			name: "agent_status",
			data: { status: "Summarizing changes...", agent: AgentNode.SUMMARIZER },
		});

		const orch = this.state.orchestratorState ?? {};
		const tasks = orch.tasks ?? [];
		const results = orch.subAgentResults ?? {};
		const scratchpad = this.state.scratchpad ?? [];
		const runId: string | undefined = this.state.internal?.metadata?.runId;
		const harnessService = this.state.internal?.harnessService;

		// Persist the artifact + sub-artifacts (regular DB work, no AI involved).
		const changes: ChangeRef[] = [];
		let artifactId: string | undefined;

		if (harnessService && runId) {
			artifactId = await harnessService.createArtifact({ runId });
			let newRouteSubArtifactId: string | undefined;

			for (const task of tasks) {
				const result = (results as Record<string, any>)[task.id];
				if (!result) continue;

				if (isRouteConfigResult(result)) {
					const type =
						result.action === "create"
							? "add"
							: result.action === "delete"
								? "delete"
								: "changes";
					const subId = await harnessService.createSubArtifact({
						artifactId,
						runId,
						subAgentId: task.id,
						kind: "route",
						action: type,
						payload: result,
					});
					if (type === "add") newRouteSubArtifactId = subId;
					const label =
						`${result.data?.method ?? ""} ${result.data?.path ?? task.title}`.trim();
					changes.push({
						label: label || task.title,
						actionLabel: type,
						agentRole: "Route configuration",
						token: `@route(type="${type}", sub_artifact_id="${subId}")`,
					});
				} else if (isBlockBuilderResult(result)) {
					const subId = await harnessService.createSubArtifact({
						artifactId,
						runId,
						subAgentId: task.id,
						kind: "canvas",
						action: "changes",
						payload: result,
					});
					let parentType: string;
					let parentRef: string;
					if (result.targetType === "route" && result.targetId) {
						parentType = "route";
						parentRef = result.targetId;
					} else if (result.targetType === "custom_block" && result.targetId) {
						parentType = "custom_block";
						parentRef = result.targetId;
					} else {
						// No existing DB record => the canvas belongs to a route created
						// in this run (parent_type=artifact references the route sub-artifact).
						parentType = "artifact";
						parentRef = newRouteSubArtifactId ?? subId;
					}
					changes.push({
						label: task.title,
						actionLabel: "changes",
						agentRole: "Canvas builder",
						token: `@canvasChanges(parent_type="${parentType}", parent="${parentRef}", artifact_id="${subId}")`,
					});
				}
			}
		}

		const changesTable = changes.length
			? changes
					.map(
						(c, i) =>
							`Change ${i + 1}: the ${c.agentRole} performed a "${c.actionLabel}" on "${c.label}".\n  EXACT TOKEN (copy verbatim, do not alter): ${c.token}`,
					)
					.join("\n\n")
			: "No structured changes were produced by the build agents.";

		const hintsText = scratchpad.length
			? scratchpad.map((s) => `- ${s}`).join("\n")
			: "None.";

		const systemPrompt = `You are the Summarizer Agent for Fluxify — a No/Low-Code Backend Engine where users build REST APIs visually from "routes" (endpoints) and "canvases" (block graphs of logic).

The build run has finished. Write a SHORT, concise, human-readable summary of what the run changed in the user's app and what (if anything) they must do next to make it work. Your output is shown directly to the user; the frontend parses special tokens inside it and renders them as interactive chips/buttons. Getting a token wrong shows the user a broken or misleading chip, so token accuracy is CRITICAL.

# TWO KINDS OF TOKENS

## A) Reference tokens — GIVEN to you (never author these yourself)
The "## Changes" section below lists each change with an EXACT token. You must:
- Write ONE concise line (a bullet or short sentence) describing that change in plain user language, then append its EXACT token VERBATIM at the very END of that line.
- Copy the token character-for-character. NEVER invent, guess, edit, reorder, or reformat a token. NEVER fabricate an id, subArtifactId, artifactId, or parent value. NEVER reuse one change's token for another. NEVER create a @route or @canvasChanges token that was not given to you.
- Emit exactly one reference token per change, and cover every change exactly once.
- These tokens MUST sit at the END of their line (nothing after them) so the chip never breaks the sentence:
  - \`@route(type="add|delete|changes", sub_artifact_id="...")\` — a route (endpoint) that was added, deleted, or changed.
  - \`@canvasChanges(parent_type="artifact|route|custom_block", parent="...", artifact_id="...")\` — logic/canvas changes. (parent_type="artifact" means the route is brand new this run; "route"/"custom_block" means it references an existing record.)

## B) Creation chips — YOU author these (only from the Hints section)
When a hint says the user must create something for the run to work, embed the matching chip INLINE where it reads naturally (these are line-safe and do NOT need to be at line end):
- \`@createIntegration(label="...")\` — user must set up an integration (e.g. a database/AI connection).
- \`@createAppConfig(label="...")\` — user must add an app config value/secret.
- \`@createRoute(label="...")\` — user must create a route.
- \`@createCustomBlock(label="...")\` — user must create a custom block.
Use a short, human-friendly \`label\` (e.g. \`label="Tasks Database"\`). Only emit these when a hint calls for it — do not invent required actions.

## Token format (all tokens)
Every attribute value MUST be wrapped in double quotes and every attribute name is snake_case with no spaces (e.g. \`sub_artifact_id\`, \`parent_type\`, \`artifact_id\`). Do not add, drop, rename, or reorder attributes.

# STRUCTURE & STYLE
- Lead with a one-line overview of what the run accomplished (no token on this line).
- Then one line per change, each ending with its exact reference token (section A).
- Put required user actions in markdown blockquotes (\`> ...\`), with any creation chips (section B) inline inside them.
- Be concise and to the point: what changed + what the user must do. NO preamble, NO restating these instructions, NO internal implementation details (no block ids, schemas, agent names, or internal reasoning).
- Plain markdown only. Do NOT wrap the output in \`\`\`markdown fences.

# EXAMPLE (shape only — use the real tokens from the Changes section, never these)
Created a new endpoint to fetch task items and wired up its logic.
- Added a route to list task items from your tasks table. @route(type="add", sub_artifact_id="abc123")
- Built the logic that reads and returns the task rows. @canvasChanges(parent_type="artifact", parent="abc123", artifact_id="def456")

> Before this works, connect your tasks database: @createIntegration(label="Tasks Database")

# Changes (each has an EXACT token to place at end of its line)
${changesTable}

# Hints / required user actions (from the build agents)
${hintsText}`;

		const userQuery =
			"Write the final summary now. Place each change's exact token verbatim at the end of its line, and follow every rule.";

		const response: any = await this.state.agentWrapper.invokeAgent({
			systemPrompt,
			messages: [],
			userQuery,
		});

		let markdown =
			typeof response === "string" ? response : response?.content || "";
		if (typeof markdown === "string") {
			markdown = markdown
				.replace(/^```(?:markdown)?\s*\n?/i, "")
				.replace(/\n?```$/i, "")
				.trim();
		}

		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "Summary ready",
				agent: AgentNode.SUMMARIZER,
				data: { artifactId },
			},
		});

		return {
			currentAgent: AgentNode.SUMMARIZER,
			summarizerState: { markdown, artifactId },
		};
	}
}
