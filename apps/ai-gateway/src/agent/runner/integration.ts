import {
	aiIntegrationsCache,
	getProjectSetting,
	mcpIntegrationsCache,
	ownsIntegration,
} from "@fluxify/server";
import type { McpConfig } from "../external";
import { integrationSupportsThinking } from "../model";

/** The `mcp` integrations the project lets its agent use (#821); unknown, deleted or foreign ids are skipped. */
export async function agentMcpServers(projectId: string): Promise<McpConfig[]> {
	const ids = (await getProjectSetting(projectId, "settings.ai.agentMcpIntegrations")) ?? "";
	return [...new Set(ids.split(",").filter(Boolean))].flatMap((id) => {
		const c = mcpIntegrationsCache[id];
		return c && ownsIntegration(c, projectId) ? [{ id, ...c }] : [];
	});
}

/** The AI integration a project's agent runs on (#661); undefined when none is set or it is not the project's. */
export async function agentIntegration(projectId: string) {
	const id = await getProjectSetting(projectId, "settings.ai.agentConnectionId");
	const integration = aiIntegrationsCache[id];
	return integration && ownsIntegration(integration, projectId) ? integration : undefined;
}

/** Whether the project's agent model takes a thinking setting (false with no model set). */
export async function projectSupportsThinking(projectId: string) {
	const integration = await agentIntegration(projectId).catch(() => undefined);
	return integration ? integrationSupportsThinking(integration) : false;
}
