import { logger } from "@fluxify/common";
import {
	generateID,
	uniqueCustomBlockName,
	withoutCustomBlockPrefix,
} from "@fluxify/lib";
import { z } from "zod";
import { dispatchAgentEvent } from "../../callbacks";
import { createFindResourceTool } from "../../tools/findResource";
import { searchDocsTool } from "../../tools/searchDocs";
import { AgentNode, type GlobalGraphState } from "../../types";
import { BaseAgent } from "../base";
import { CUSTOM_BLOCK_PARAMETER_CONTRACT } from "./customBlockContract";

const inputParamSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("text_input"), name: z.string(), label: z.string(), description: z.string().nullish() }),
	z.object({ type: z.literal("checkbox"), name: z.string(), label: z.string(), description: z.string().nullish() }),
	z.object({ type: z.literal("array_editor"), name: z.string(), label: z.string(), description: z.string().nullish() }),
	z.object({ type: z.literal("dropdown"), name: z.string(), label: z.string(), options: z.array(z.object({ label: z.string(), value: z.string() })), description: z.string().nullish() }),
	z.object({ type: z.literal("integration_selector"), name: z.string(), label: z.string(), group: z.string(), variant: z.string().nullish(), tags: z.array(z.string()).default([]), description: z.string().nullish() }),
	z.object({ type: z.literal("app_config_selector"), name: z.string(), label: z.string(), description: z.string().nullish() }),
]);

const customBlockConfigSchema = z.object({
	action: z.enum(["create", "delete", "update-partial"]),
	customBlockId: z.string().nullish(),
	data: z.object({
		name: z.string().nullish(),
		label: z.string().nullish(),
		description: z.string().nullish(),
		inputParams: z.array(inputParamSchema).nullish(),
	}).nullish(),
});

/**
 * The bare, unclaimed name to store a new block under.
 *
 * Stored project blocks carry the `user_defined.project.` prefix, so that is
 * the form the model sees in the inventory and in the current-context block —
 * and it proposes it straight back, dots and all. The create DTO takes the
 * bare name only (storage adds the prefix itself), so a prefixed name is a
 * correct intent in the wrong vocabulary, not a mistake to reject: strip it.
 */
export const settleName = (name: string, taken: ReadonlySet<string>) =>
	uniqueCustomBlockName(withoutCustomBlockPrefix(name), taken);

export class CustomBlockConfigAgent extends BaseAgent {
	/**
	 * Settles the name here, before Block Builder writes `custom:<name>` into a
	 * caller's canvas. A collision resolved any later is not resolvable at all:
	 * the caller is already bound to the block that held the name first, and the
	 * create fails with a conflict at apply.
	 */
	private async freeName(name: string): Promise<string> {
		const projectId = this.state.internal?.metadata?.projectId || "";
		const taken = new Set(
			(
				await this.state.internal.dbService.getAllCustomBlocks(projectId)
			).map(({ name }: { name: string }) => name),
		);
		const free = settleName(name, taken);
		if (free !== name) {
			logger.warn("[CustomBlockConfig] Settled custom block name", {
				requested: name,
				renamed: free,
			});
		}
		return free;
	}

	async execute(): Promise<Partial<GlobalGraphState>> {
		const activeTask = this.state.activeTask;
		if (!activeTask) throw new Error("CustomBlockConfigAgent requires an active task.");

		await dispatchAgentEvent({ name: "agent_status", data: { status: "Defining custom block contract...", agent: AgentNode.CUSTOM_BLOCK_CONFIG_AGENT, agentId: activeTask.id } });
		const systemPrompt = `You are Fluxify's Custom Block Config Agent. Determine exact create, update, or delete intent for reusable custom-block metadata and caller parameters.
${CUSTOM_BLOCK_PARAMETER_CONTRACT}
## Strict Rules
- \`create\` requires \`data.name\`, \`data.label\`, and \`data.inputParams\`. Name is lowercase snake_case and becomes runtime block type; never invent a UUID.
- \`data.name\` is the bare name (\`generate_random_ids\`). Existing blocks are listed under a \`user_defined.project.\` storage prefix — never copy that prefix into \`data.name\`; storage adds it.
- \`update-partial\` and \`delete\` require exact \`customBlockId\` from task context. Existing custom block names are immutable because caller canvases invoke them by name; only label, description, and inputParams may change.
- For new custom blocks, this output runs before Block Builder. Define full caller contract now so canvas agent can consume it exactly.
- Search docs only for an uncovered platform feature. Batch every query in one \`searchQueries\` call.
## Output Contract
\`{ "action": "create", "customBlockId": "<planned id>", "data": { "name": "send_notification", "label": "Send Notification", "description": "Sends a notification", "inputParams": [] } }\``;
		const response = await this.state.agentWrapper.invokeAgent({
			zodSchema: customBlockConfigSchema,
			systemPrompt,
			context: this.state.internal?.metadata?.contextBlock,
			tools: [searchDocsTool, createFindResourceTool(this.state.internal.dbService, this.state.internal?.metadata ?? {})],
			messages: [],
			userQuery: `Task Title: ${activeTask.title}\nTask Description: ${activeTask.description}${activeTask.supervisorReviews ? `\nSupervisor Reviews:\n${activeTask.supervisorReviews}` : ""}`,
			agentNode: AgentNode.CUSTOM_BLOCK_CONFIG_AGENT,
			agentId: activeTask.id,
		}) as z.infer<typeof customBlockConfigSchema>;
		if (response.action === "create" && !response.customBlockId) response.customBlockId = generateID();
		if (response.action === "create" && response.data?.name) {
			response.data.name = await this.freeName(response.data.name);
		}
		await dispatchAgentEvent({ name: "agent_status", data: { status: "Custom block contract formulated", agent: AgentNode.CUSTOM_BLOCK_CONFIG_AGENT, agentId: activeTask.id, data: response } });
		return { currentAgent: AgentNode.CUSTOM_BLOCK_CONFIG_AGENT, orchestratorState: { ...this.state.orchestratorState, subAgentResults: { ...(this.state.orchestratorState?.subAgentResults ?? {}), [activeTask.id]: response } } };
	}
}

export const validateCustomBlockConfigOutput: import("../../types").AgentOutputValidator = (result) => {
	const value = result as z.infer<typeof customBlockConfigSchema>;
	if (!value?.action) return "Missing custom block action.";
	if ((value.action === "update-partial" || value.action === "delete") && !value.customBlockId) return `Action '${value.action}' requires customBlockId.`;
	if (value.action === "create") {
		if (!value.data?.name?.match(/^[a-z0-9_]+$/)) return `Custom block create requires lowercase snake_case data.name — letters, digits and underscores only, with no dots and no "user_defined.project." prefix. Got "${value.data?.name ?? ""}".`;
		if (!value.data.label?.trim()) return "Custom block create requires data.label.";
		if (!value.data.inputParams) return "Custom block create requires data.inputParams (use [] when none).";
	}
	const names = value.data?.inputParams?.map((p) => p.name) ?? [];
	if (new Set(names).size !== names.length) return "Custom block inputParams cannot contain duplicate names.";
	// storage takes lowercase snake_case only; a camelCase name gets no further
	// than the create DTO, and only at apply time, as "Malformed operation"
	const badName = names.find((name) => !/^[a-z0-9_]+$/.test(name));
	if (badName) return `Custom block inputParam name "${badName}" must be lowercase snake_case (letters, digits and underscores only).`;
	return null;
};
